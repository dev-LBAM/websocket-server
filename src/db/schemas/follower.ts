import mongoose, { Schema } from 'mongoose'
  
const FollowerSchema = new Schema({
    userId: 
    { 
        type: Schema.Types.ObjectId, 
        required: true 
    },
    followedId: 
    { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
},
{
    timestamps: true,
})
  
interface IFollower extends Document 
{
    userId: Schema.Types.ObjectId
    followedId: Schema.Types.ObjectId
}
  
FollowerSchema.index({ userId: 1, followedId: 1 }, { unique: true })
  
const Follower = mongoose.models.Follower || mongoose.model<IFollower>('Follower', FollowerSchema)
  
export default Follower
  