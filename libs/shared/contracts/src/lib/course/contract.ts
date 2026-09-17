import { initContract } from "@ts-rest/core";
import { ErrorSchema, SuccessSchema } from "../common";
import {
  createCourseSchema,
  createVideoInCourseSchema,
  getAllCoursesSchema,
  getAllVideosOfCourseSchema,
  getCourseByIdSchema,
  updateCourseSchema,
  updateVideoInCourseSchema,
} from "./schema";
import { z } from "zod";

const c = initContract();

export const courseContract = c.router({
  createCourse: {
    method: "POST",
    path: "/course/create",
    body: createCourseSchema,
    responses: {
      201: SuccessSchema,
      403: ErrorSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Create a new course",
  },
  getAllCourses: {
    method: "GET",
    query: z.object({
      packageId: z.string().optional(),
    }),
    path: "/course/getAllCourses",
    responses: {
      200: getAllCoursesSchema,
      403: ErrorSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Get all courses",
  },
  getCourseById: {
    method: "GET",
    path: "/course/:id",
    responses: {
      200: getCourseByIdSchema,
      403: ErrorSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Get all courses",
  },
  updateCourse: {
    method: "PATCH",
    path: "/course/:id",
    pathParams: z.object({ id: z.string() }),
    body: updateCourseSchema,
    responses: {
      200: SuccessSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Update a course",
  },
  deleteCourse: {
    method: "DELETE",
    path: "/course/:id",
    pathParams: z.object({ id: z.string() }),
    body: z.object({}).optional(),
    responses: {
      200: SuccessSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Delete a course",
  },
  createVideoInCourse: {
    method: "POST",
    path: "/course/createVideoInCourse/:courseId",
    body: createVideoInCourseSchema,
    responses: {
      201: SuccessSchema,
      403: ErrorSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Create a new course",
  },
  getVideosOfCourse: {
    method: "GET",
    path: "/course/getVideosOfCourse/:courseId",
    responses: {
      200: getAllVideosOfCourseSchema,
      403: ErrorSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Get all courses",
  },
  updateVideoInCourse: {
    method: "PATCH",
    path: "/course/updateVideoInCourse/:videoId",
    pathParams: z.object({ videoId: z.string() }),
    body: updateVideoInCourseSchema,
    responses: {
      200: SuccessSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Update a video of a course",
  },
  deleteVideoInCourse: {
    method: "DELETE",
    path: "/course/deleteVideoInCourse/:videoId",
    pathParams: z.object({ videoId: z.string() }),
    body: z.object({}).optional(),
    responses: {
      200: SuccessSchema,
      404: ErrorSchema,
      500: ErrorSchema,
    },
    summary: "Delete a video of a course",
  },
});
