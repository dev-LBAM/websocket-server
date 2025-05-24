import mongoose, { Schema } from 'mongoose'

const UserSchema = new Schema({
  username: 
  {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  name: 
  {
    type: String,
    required: true,
    trim: true,
  },
  email: 
  {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  password: 
  {
    type: String,
    required: true,
    minlength: 60,
    maxlength: 72,
  },
  gender: 
  {
    type: String,
    required: true,
  },
  birthDate: 
  {
    type: Date,
    required: true,
  },
  country: 
  {
    type: String,
    required: true,
  },
  state: 
  {
    type: String,
    required: true,
  },
  city: 
  {
    type: String,
    required: true,
  },
  profileImg: {
    type: String,
    default: "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y",
  },
  isOnline:{
    type: Boolean
  }, 
  lastSeen:{
    type: Date
  }
},
{
  timestamps: true,
})

export interface IUser extends Document 
{
  username: string
  name: string
  email: string
  password: string
  birthDate: Date
  country: string
  state: string
  city: string
  isOnline: boolean
  lastSeen: Date
}

const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema)

export default User
