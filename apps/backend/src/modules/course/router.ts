import { initServer } from '@ts-rest/express';
import { courseContract } from '@srk/shared/contracts';
import { courseMutationHandler } from './mutation';
import { courseQueryHandler } from './query';
const s = initServer();

export const courseRouter = s.router(courseContract, {
  createCourse: courseMutationHandler.createCourse,
  updateCourse: courseMutationHandler.updateCourse,
  deleteCourse: courseMutationHandler.deleteCourse,
  createVideoInCourse: courseMutationHandler.createVideoInCourse,
  updateVideoInCourse: courseMutationHandler.updateVideoInCourse,
  deleteVideoInCourse: courseMutationHandler.deleteVideoInCourse,
  getAllCourses: courseQueryHandler.getAllCourses,
  getVideosOfCourse: courseQueryHandler.getVideosOfCourse,
  getCourseById: courseQueryHandler.getCourseById,
});
