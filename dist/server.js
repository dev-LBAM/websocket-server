"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongodb_1 = require("./db/mongodb");
const user_1 = __importDefault(require("./db/schemas/user"));
const ioredis_1 = __importDefault(require("ioredis"));
const mutualFollowersOnOff_service_1 = require("./services/mutualFollowersOnOff.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cookie_parser_1.default)());
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.BASE_URL,
        credentials: true,
    },
});
const redis = new ioredis_1.default(process.env.REDIS_URL);
//Check if user is authenticated
const verifyAuthForSocket = (cookieHeader) => {
    const cookies = Object.fromEntries(cookieHeader.split(';').map(cookie => {
        const [name, ...rest] = cookie.trim().split('=');
        return [name, rest.join('=')];
    }));
    const refreshToken = cookies.refreshToken;
    if (!refreshToken)
        return null;
    const decoded = jsonwebtoken_1.default.verify(refreshToken, process.env.SECRET_TOKEN_KEY);
    return decoded;
};
// Middleware socket
io.use(async (socket, next) => {
    await (0, mongodb_1.connectToDB)();
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader)
        return next(new Error('Session expired'));
    const decoded = verifyAuthForSocket(cookieHeader);
    if (!decoded)
        return next(new Error('Session expired'));
    const user = await user_1.default.findById(decoded.userId).select('name profileImg userId');
    if (!user)
        return next(new Error('User not found'));
    socket.userId = decoded.userId;
    socket.name = user.name;
    socket.profileImg = user.profileImg;
    next();
});
io.on('connection', async (socket) => {
    console.log(`🟢 ${socket.name} connected with socket ${socket.id}`);
    const connectionCount = await redis.incr(`connections:${socket.userId}`);
    // Marca como online apenas se for a primeira conexão
    if (connectionCount === 1) {
        await redis.hset('users_online', socket.userId, JSON.stringify({
            userId: socket.userId,
            socketId: socket.id,
            name: socket.name,
            profileImg: socket.profileImg
        }));
    }
    const { usersOnline, usersOffline } = await (0, mutualFollowersOnOff_service_1.getMutualFollowerService)(socket.userId);
    // Notify all mutual followers online who user logged
    for (const user of usersOnline) {
        socket.to(user.socketId).emit('mutual_follower_login', {
            _id: socket.userId,
            name: socket.name,
            profileImg: socket.profileImg,
            lastSeen: null
        });
    }
    // Send all mutual followers online to the user
    if (usersOnline.length > 0) {
        socket.emit('mutual_followers_online', usersOnline);
    }
    // Send all mutual followers offline to the user
    if (usersOffline.length > 0) {
        socket.emit('mutual_followers_offline', usersOffline);
    }
    // When user disconnect
    socket.on('disconnect', async () => {
        const remaining = await redis.decr(`connections:${socket.userId}`);
        // Se ainda tiver outras conexões abertas, não considera offline
        if (remaining > 0)
            return;
        // Remove de online
        await redis.hdel('users_online', socket.userId);
        await redis.del(`connections:${socket.userId}`);
        const userLogout = await user_1.default.findByIdAndUpdate(socket.userId, {
            lastSeen: new Date()
        });
        const { usersOnline } = await (0, mutualFollowersOnOff_service_1.getMutualFollowerService)(socket.userId);
        for (const user of usersOnline) {
            // Notify all mutual followers online who user logout
            io.to(user.socketId).emit('mutual_follower_logout', {
                _id: String(userLogout._id),
                name: userLogout.name,
                profileImg: userLogout.profileImg,
                lastSeen: userLogout.lastSeen
            });
        }
        console.log(`🔴 ${socket.name} disconnected`);
    });
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
    //Clear status data on redis
    await redis.del('users_online');
    const keys = await redis.keys('connections:*');
    if (keys.length > 0) {
        await redis.del(...keys);
    }
    console.log(`Servidor WebSocket rodando na porta ${PORT}`);
});
