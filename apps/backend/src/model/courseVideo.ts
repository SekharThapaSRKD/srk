import mongoose from "mongoose";

export interface ICourseVideo extends mongoose.Document {
  name: string;
  courseId: mongoose.Types.ObjectId;
  videoUrl: string;
  originalVideoUrl?: string;
  videoRenditions?: { quality: string; url: string }[];
  thumbnailUrl?: string;
  duration: number;
  createdAt: Date;
  updatedAt: Date;
}

const courseVideoSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
    originalVideoUrl: {
      type: String,
    },
    // Lower-quality alternates (e.g. "720p", "360p") for playback on
    // unstable connections. An array rather than fixed fields (videoUrl720p,
    // videoUrl360p, ...) so new quality levels can be added later without a
    // schema change - just push another { quality, url } entry.
    videoRenditions: {
      type: [
        {
          quality: { type: String, required: true },
          url: { type: String, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    thumbnailUrl: {
      type: String,
    },
    duration: {
      type: Number, //in seconds
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const CourseVideoModel = mongoose.model<ICourseVideo>(
  "CourseVideo",
  courseVideoSchema
);
