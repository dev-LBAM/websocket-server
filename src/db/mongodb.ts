import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
const MONGODB_URI = process.env.MONGODB_URI!

if (!MONGODB_URI) 
{
  throw new Error('Please define the MONGODB_URI to make the connection.')
}

export async function connectToDB()
{
    if(mongoose.connection.readyState >= 1) return mongoose.connection
    try
    {
        await mongoose.connect(MONGODB_URI)
        console.log('\u{1F4BB} Connection to database successful.')
    } 
    catch
    {
        throw new Error('Connection with database failed.')
    } 
}
