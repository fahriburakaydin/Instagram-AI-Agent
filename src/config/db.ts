import mongoose from 'mongoose';
import logger from './logger';

export const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || '', {
      // These options are no longer necessary
    });
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};


// below your existing connection logic, add:
const repliedCommentSchema = new mongoose.Schema({
  commentId: { type: String, required: true, unique: true },
  repliedAt: { type: Date, default: Date.now },
});
export const RepliedComment = mongoose.model("RepliedComment", repliedCommentSchema);

const dmSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  repliedAt: { type: Date, default: Date.now },
});
export const RepliedDM = mongoose.model("RepliedDM", dmSchema);

