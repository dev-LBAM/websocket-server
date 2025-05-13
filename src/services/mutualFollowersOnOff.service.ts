import Redis from 'ioredis'
import Follower from '../db/schemas/follower'
import User from '../db/schemas/user'

const redis = new Redis(process.env.REDIS_URL!)

export async function getMutualFollowerService(userId: string) 
{

  const following = await Follower.find({ userId }).select('followedId')
  const followingIds = following.map(f => f.followedId.toString())

  const followers = await Follower.find({ followedId: userId }).select('userId')
  const followerIds = followers.map(f => f.userId.toString())

  const mutualIds = followingIds.filter(id => followerIds.includes(id))

  if (mutualIds.length === 0) {
    return { usersOnline: [], usersOffline: [] }
  }

  const mutualUsers = await User.find({ _id: { $in: mutualIds } })
    .select('_id name profileImg lastSeen')
    .lean()

  const mutualMap = new Map(mutualUsers.map(user => [String(user._id), user]))

  const usersOnline: {
    _id: string
    name: string
    profileImg: string
    lastSeen: Date
    socketId: string
  }[] = []

  const usersOffline: {
    _id: string
    name: string
    profileImg: string
    lastSeen: Date
  }[] = []

  for (const id of mutualIds) {
    const userData = mutualMap.get(id)
    if (!userData) continue

    const redisStr = await redis.hget('users_online', id)

    if (redisStr) {
      const redisData = JSON.parse(redisStr)
      usersOnline.push({
        _id: String(userData._id),
        name: userData.name,
        profileImg: userData.profileImg,
        lastSeen: userData.lastSeen,
        socketId: redisData.socketId
      })
    } else {
      usersOffline.push({
        _id: String(userData._id),
        name: userData.name,
        profileImg: userData.profileImg,
        lastSeen: userData.lastSeen
      })
    }
  }

  return { usersOnline, usersOffline }
}
