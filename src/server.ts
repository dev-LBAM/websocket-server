import express from 'express'
import http from 'http'
import { Server, Socket } from 'socket.io'
import cookieParser from 'cookie-parser'
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
    username: string
  }
}

//Middleware socket
io.use(async (socket: Socket, next) => {
  try {
    await connectToDB()
    const userId = socket.handshake.auth.userId

    const user = await User.findById(userId).select('name username profileImg userId')
    if (!user) return next(new Error('User not found'))

    socket.userId = user._id
    socket.name = user.name
    socket.profileImg = user.profileImg
    socket.username = user.username
    next()
  } catch (err) {
    console.error('Auth middleware error:', err)
    next(new Error('Authentication error'))
  }
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
    profileImg: socket.profileImg,
    username: socket.username,
    loggedAt: new Date(Date.now())
  }))}

  const { usersOnline, usersOffline } = await getMutualFollowerService(socket.userId);

  // Notify all mutual followers online who user logged
  for(const user of usersOnline) 
  {
    socket.to(user.socketId).emit('mutual_follower_login', {
    _id: socket.userId,
    name: socket.name,
    username: socket.username,
    profileImg: socket.profileImg,
    lastSeen: null,
    loggedAt: new Date(Date.now())
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

  socket.on('private_message', async (message) => {
    const { receiverId } = message;

    if (!receiverId) return;
    const userJson = await redis.hget('users_online', receiverId);

    if (!userJson) {
      console.log(`❌ Usuário ${receiverId} não está online`);
      return;
    }

const receiverSocket = JSON.parse(userJson);
const receiverSocketId = receiverSocket.socketId;
    console.log(`📨 Mensagem recebida do ${message.senderId} para ${receiverId}`);

    socket.to(receiverSocketId).emit('chat_message', message);
  });

  socket.on("typing", async ({ senderId, receiverId }) => {
        if (!receiverId) return;
    const userJson = await redis.hget('users_online', receiverId);

    if (!userJson) {
      console.log(`❌ Usuário ${receiverId} não está online`);
      return;
    }
    const receiverSocket = JSON.parse(userJson);
    const receiverSocketId = receiverSocket.socketId;
  socket.to(receiverSocketId).emit("user_typing", { senderId });
});
  // When user disconnect
  socket.on('disconnect', async () => 
  {
    const remaining = await redis.decr(`connections:${socket.userId}`);

    if (remaining > 0) return;
  
    await redis.hdel('users_online', socket.userId);
    await redis.del(`connections:${socket.userId}`);

    
const userLogout = await User.findByIdAndUpdate(socket.userId, 
    {
      lastSeen: new Date()
    }, 
    { new: true }
);

    const { usersOnline } = await getMutualFollowerService(socket.userId);

    for (const user of usersOnline) 
    {
      // Notify all mutual followers online who user logout
      io.to(user.socketId).emit('mutual_follower_logout', {
        _id: String(userLogout._id),
        name: userLogout.name,
        username: userLogout.username,
        profileImg: userLogout.profileImg,
        lastSeen: userLogout.lastSeen
      });
    }
    console.log(`🔴 ${socket.name} disconnected`);
  })
})


const PORT = Number(process.env.PORT) || 3001
server.listen(PORT, async () => {
  //Clear status data on redis
  await redis.del('users_online')
  const keys = await redis.keys('connections:*')
  if(keys.length > 0) 
  {
    await redis.del(...keys)
  }

  console.log(`WebSocket server running on port ${PORT}`)
})

