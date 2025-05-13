"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMutualFollowerService = getMutualFollowerService;
const ioredis_1 = __importDefault(require("ioredis"));
const follower_1 = __importDefault(require("../db/schemas/follower"));
const user_1 = __importDefault(require("../db/schemas/user"));
const redis = new ioredis_1.default(process.env.REDIS_URL);
async function getMutualFollowerService(userId) {
    const following = await follower_1.default.find({ userId }).select('followedId');
    const followingIds = following.map(f => f.followedId.toString());
    const followers = await follower_1.default.find({ followedId: userId }).select('userId');
    const followerIds = followers.map(f => f.userId.toString());
    const mutualIds = followingIds.filter(id => followerIds.includes(id));
    if (mutualIds.length === 0) {
        return { usersOnline: [], usersOffline: [] };
    }
    const mutualUsers = await user_1.default.find({ _id: { $in: mutualIds } })
        .select('_id name profileImg lastSeen')
        .lean();
    const mutualMap = new Map(mutualUsers.map(user => [String(user._id), user]));
    const usersOnline = [];
    const usersOffline = [];
    for (const id of mutualIds) {
        const userData = mutualMap.get(id);
        if (!userData)
            continue;
        const redisStr = await redis.hget('users_online', id);
        if (redisStr) {
            const redisData = JSON.parse(redisStr);
            usersOnline.push({
                _id: String(userData._id),
                name: userData.name,
                profileImg: userData.profileImg,
                lastSeen: userData.lastSeen,
                socketId: redisData.socketId
            });
        }
        else {
            usersOffline.push({
                _id: String(userData._id),
                name: userData.name,
                profileImg: userData.profileImg,
                lastSeen: userData.lastSeen
            });
        }
    }
    return { usersOnline, usersOffline };
}
