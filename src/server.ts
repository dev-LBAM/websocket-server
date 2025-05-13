import express from 'express'
import http from 'http'
import { Server, Socket } from 'socket.io'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import { connectToDB } from './db/mongodb'
import User from './db/schemas/user'
import Redis from 'ioredis'
import { getMutualFollowerService } from './services/mutualFollowersOnOff.service'

dotenv.config()
const app = express()
app.use(cookieParser())
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.BASE_URL,
    credentials: true,
  },
})

const redis = new Redis(process.env.REDIS_URL!)

//Extension of type to userId
declare module 'socket.io'
{
  interface Socket {
    userId: string
    name: string
    profileImg: string
  }
}

//Check if user is authenticated
const verifyAuthForSocket = (cookieHeader: string): { userId: string } | null => 
{
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(cookie => {
      const [name, ...rest] = cookie.trim().split('=')
      return [name, rest.join('=')]
    })
  )

  const refreshToken = cookies.refreshToken
  if (!refreshToken) return null

  const decoded = jwt.verify(refreshToken, process.env.SECRET_TOKEN_KEY!) as { userId: string }
  return decoded
}


// Middleware socket
io.use(async (socket: Socket, next) => 
{
  await connectToDB()
  const cookieHeader = socket.handshake.headers.cookie

  if (!cookieHeader) return next(new Error('Session expired'))

  const decoded = verifyAuthForSocket(cookieHeader)
  if (!decoded) return next(new Error('Session expired'))

  const user = await User.findById(decoded.userId).select('name profileImg userId')
  if (!user) return next(new Error('User not found'))


  socket.userId = decoded.userId
  socket.name = user.name
  socket.profileImg = user.profileImg
  next()
})


io.on('connection', async (socket: Socket) => 
{
  console.log(`🟢 ${socket.name} connected with socket ${socket.id}`)


  const connectionCount = await redis.incr(`connections:${socket.userId}`);

// Marca como online apenas se for a primeira conexão
if (connectionCount === 1) {
  await redis.hset('users_online', socket.userId, JSON.stringify({
    userId: socket.userId,
    socketId: socket.id,
    name: socket.name,
    profileImg: socket.profileImg
  }))}


  const { usersOnline, usersOffline } = await getMutualFollowerService(socket.userId);

  // Notify all mutual followers online who user logged
  for(const user of usersOnline) 
  {
    socket.to(user.socketId).emit('mutual_follower_login', {
    _id: socket.userId,
    name: socket.name,
    profileImg: socket.profileImg,
    lastSeen: null
    });
  }

  // Send all mutual followers online to the user
  if (usersOnline.length > 0) 
  {
    socket.emit('mutual_followers_online', usersOnline);
  }

  // Send all mutual followers offline to the user
  if (usersOffline.length > 0) 
  {
    socket.emit('mutual_followers_offline', usersOffline);
  }

  // When user disconnect
  socket.on('disconnect', async () => 
  {
    const remaining = await redis.decr(`connections:${socket.userId}`);

    // Se ainda tiver outras conexões abertas, não considera offline
    if (remaining > 0) return;
  
    // Remove de online
    await redis.hdel('users_online', socket.userId);
    await redis.del(`connections:${socket.userId}`);

    
    const userLogout = await User.findByIdAndUpdate(socket.userId, 
    {
      lastSeen: new Date()
    })

    const { usersOnline } = await getMutualFollowerService(socket.userId);

    for (const user of usersOnline) 
    {
      // Notify all mutual followers online who user logout
      io.to(user.socketId).emit('mutual_follower_logout', {
        _id: String(userLogout._id),
        name: userLogout.name,
        profileImg: userLogout.profileImg,
        lastSeen: userLogout.lastSeen
      });
    }
    console.log(`🔴 ${socket.name} disconnected`);
  })
})

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  //Clear status data on redis
  await redis.del('users_online')
  const keys = await redis.keys('connections:*')
  if(keys.length > 0) 
  {
    await redis.del(...keys)
  }

  console.log(`Servidor WebSocket rodando na porta ${PORT}`);
})

