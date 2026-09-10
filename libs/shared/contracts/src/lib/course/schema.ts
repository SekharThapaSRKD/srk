import { z } from "zod";

export const createCourseSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
  package: z.string().array(),
});

export const getAllCoursesSchema = z.array(
  z.object({
    _id: z.string(),
    title: z.string(),
    description: z.string(),
    image: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
);

export const getCourseByIdSchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string(),
  image: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const getAllVideosOfCourseSchema = z.array(
  z.object({
    _id: z.string(),
    name: z.string(),
    videoUrl: z.string(),
    thumbnailUrl: z.string(),
    created_at: z.date(),
    updatedAt: z.date(),
    videoRenditions: z
      .array(z.object({ quality: z.string(), url: z.string() }))
      .optional(),
  })
);

export const createVideoInCourseSchema = z.object({
  name: z.string(),
  videoUrl: z.string(),
  thumbnailUrl: z.string().optional(),
  duration: z.number(),
});
