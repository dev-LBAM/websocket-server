"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectToDB = connectToDB;
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI to make the connection.');
}
async function connectToDB() {
    if (mongoose_1.default.connection.readyState >= 1)
        return mongoose_1.default.connection;
    try {
        await mongoose_1.default.connect(MONGODB_URI);
        console.log('\u{1F4BB} Connection to database successful.');
    }
    catch {
        throw new Error('Connection with database failed.');
    }
}
