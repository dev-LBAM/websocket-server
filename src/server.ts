import express from 'express'
import cors from 'cors'
import http from 'http'
import { Server, Socket } from 'socket.io'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import { connectToDB } from './db/mongodb'
import User from './db/schemas/user'
import Redis from 'ioredis'
import { getMutualFollowerService } from './services/mutualFollowersOnOff.service'

// Carrega variáveis de ambiente
dotenv.config()

const app = express()

// 1. CORS do Express antes de criar o servidor HTTP para liberar polling
app.use(cors({
  origin: process.env.BASE_URL,    // ex: 'https://social-blog-murex.vercel.app'
  methods: ['GET', 'POST'],
  credentials: true,
}))

// Middleware de cookies
app.use(cookieParser())


// Cria servidor HTTP
const server = http.createServer(app)

// Inicializa Socket.IO com CORS e transportes
const io = new Server(server, {
  cors: {
    origin: process.env.BASE_URL,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})

// Conexão Redis
const redis = new Redis(process.env.REDIS_URL!)

// Extensão de tipo para Socket
declare module 'socket.io' {
  interface Socket {
    userId: string
    name: string
    profileImg: string
  }
}

// Função de verificação de autenticação via cookie
const verifyAuthForSocket = (cookieHeader: string): { userId: string } | null => {
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

// Middleware de autenticação do Socket.IO
io.use(async (socket: Socket, next) => {
  try {
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
  } catch (err) {
    console.error('Auth middleware error:', err)
    next(new Error('Authentication error'))
  }
})

// Eventos de conexão
io.on('connection', async (socket: Socket) => {
  console.log(`🟢 ${socket.name} connected with socket ${socket.id}`)

  // Emite evento de teste para validar conexão
  socket.emit('ping')

  // Lógica de contagem de conexões e mutual followers...
  const connectionCount = await redis.incr(`connections:${socket.userId}`)
  if (connectionCount === 1) {
    await redis.hset('users_online', socket.userId, JSON.stringify({
      userId: socket.userId,
      socketId: socket.id,
      name: socket.name,
      profileImg: socket.profileImg
    }))
  }
  const { usersOnline, usersOffline } = await getMutualFollowerService(socket.userId)
  usersOnline.forEach(user => {
    socket.to(user.socketId).emit('mutual_follower_login', {
      _id: socket.userId,
      name: socket.name,
      profileImg: socket.profileImg,
      lastSeen: null
    })
  })
  if (usersOnline.length > 0) socket.emit('mutual_followers_online', usersOnline)
  if (usersOffline.length > 0) socket.emit('mutual_followers_offline', usersOffline)

  socket.on('disconnect', async () => {
    const remaining = await redis.decr(`connections:${socket.userId}`)
    if (remaining > 0) return
    await redis.hdel('users_online', socket.userId)
    await redis.del(`connections:${socket.userId}`)

    const userLogout = await User.findByIdAndUpdate(socket.userId, { lastSeen: new Date() })
    const { usersOnline: stillOnline } = await getMutualFollowerService(socket.userId)
    stillOnline.forEach(user => {
      io.to(user.socketId).emit('mutual_follower_logout', {
        _id: String(userLogout._id),
        name: userLogout.name,
        profileImg: userLogout.profileImg,
        lastSeen: userLogout.lastSeen
      })
    })
    console.log(`🔴 ${socket.name} disconnected`)
  })
})

// Inicializa o servidor
const PORT = Number(process.env.PORT) || 3001
server.listen(PORT, async () => {
  // Limpa status no Redis
  await redis.del('users_online')
  const keys = await redis.keys('connections:*')
  if (keys.length > 0) await redis.del(...keys)
  console.log(`Servidor WebSocket rodando na porta ${PORT}`)
})
