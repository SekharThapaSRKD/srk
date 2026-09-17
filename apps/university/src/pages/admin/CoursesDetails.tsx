import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Input,
  Button,
  Textarea,
  Card,
  CardHeader,
  CardBody,
  Progress,
} from "@nextui-org/react";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  ModalContent,
} from "@nextui-org/modal";
import { Pencil, Trash } from "lucide-react";
import { PrimaryButton } from "../../components/ReusableComponents";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteCourseVideoApi,
  getCourseDetailsByIdApi,
  getCourseVideoByCourseId,
  updateCourseApi,
  updateCourseVideoApi,
  uploadVideoApi,
} from "../../lib/apiClient";
import { TCourse, TCourseVideo } from "../../lib/types/entities";
import { TUploadVideoPayload } from "../../lib/types";
import useAlert from "../../hooks/useAlert";
import { AxiosError } from "axios";
import { useSRKFileUpload } from '@srk/shared/hooks';
import { getUniversityAssetUrl } from "../../lib/cdn";

interface Video {
  url: string;
}

interface Chapter {
  name: string;
  videos: Video[];
}

function CourseDetail() {
  const { id } = useParams<{ id: string }>();
  const [file, setFile] = useState<File | null>(null);
  const [chapterName, setChapterName] = useState("");
  const [progress, setProgress] = useState(0);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [editableCourse, setEditableCourse] = useState<TCourse | null>(null);
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const { uploadFile, isUploading } = useSRKFileUpload('university');
  const { show } = useAlert();
  console.log("chapters", chapters);

  const [editingVideo, setEditingVideo] = useState<TCourseVideo | null>(null);
  const [editingVideoName, setEditingVideoName] = useState("");
  const [videoToDelete, setVideoToDelete] = useState<TCourseVideo | null>(
    null
  );
  const {
    isOpen: isEditVideoModalOpen,
    onOpen: openEditVideoModal,
    onOpenChange: onEditVideoModalOpenChange,
  } = useDisclosure();
  const {
    isOpen: isDeleteVideoModalOpen,
    onOpen: openDeleteVideoModal,
    onOpenChange: onDeleteVideoModalOpenChange,
  } = useDisclosure();

  const { data: course } = useQuery<TCourse | undefined>({
    queryKey: ["courseDetails", id],
    queryFn: () => {
      if (!id) return;
      return getCourseDetailsByIdApi(id);
    },
    enabled: !!id,
  });
  const { invalidateQueries } = useQueryClient();

  const { data: courseVideos } = useQuery<TCourseVideo[] | undefined>({
    queryKey: ["videosOfCourse", course?._id],
    queryFn: () => {
      if (!course) return;
      return getCourseVideoByCourseId(course._id);
    },
    enabled: !!course?._id,
  });
  const { mutate: uploadVideoMutation, isPending: isRegisteringVideo } = useMutation({
    mutationKey: ["uploadVideo"],
    mutationFn: async (data: TUploadVideoPayload) => {
      const res = await uploadVideoApi(data);
      return res;
    },
    onSuccess: () => {
      setFile(null);
      setChapterName("");
      setProgress(0);
      invalidateQueries({ queryKey: ["videosOfCourse"] });
      show("Video uploaded successfully", "success");
    },
    onError: (error: AxiosError<{ message: string }>) => {
      setProgress(0);
      show(error.response?.data.message || "Failed to upload video", "error");
    },
  });

  const { mutate: updateCourseMutation, isPending: isSavingCourse } =
    useMutation({
      mutationKey: ["updateCourse"],
      mutationFn: async (data: TCourse) => {
        if (!course) return;
        return updateCourseApi(course._id, {
          title: data.title,
          description: data.description,
          image: data.image,
        });
      },
      onSuccess: () => {
        invalidateQueries({ queryKey: ["courseDetails", id] });
        show("Course updated successfully", "success");
      },
      onError: (error: AxiosError<{ message: string }>) => {
        show(
          error.response?.data.message || "Failed to update course",
          "error"
        );
      },
    });

  const { mutate: updateVideoMutation } = useMutation({
    mutationKey: ["updateCourseVideo"],
    mutationFn: async (data: { videoId: string; name: string }) => {
      return updateCourseVideoApi(data.videoId, data.name);
    },
    onSuccess: () => {
      invalidateQueries({ queryKey: ["videosOfCourse"] });
      show("Video updated successfully", "success");
      setEditingVideo(null);
      setEditingVideoName("");
    },
    onError: (error: AxiosError<{ message: string }>) => {
      show(
        error.response?.data.message || "Failed to update video",
        "error"
      );
    },
  });

  const { mutate: deleteVideoMutation } = useMutation({
    mutationKey: ["deleteCourseVideo"],
    mutationFn: async (videoId: string) => deleteCourseVideoApi(videoId),
    onSuccess: () => {
      invalidateQueries({ queryKey: ["videosOfCourse"] });
      show("Video deleted successfully", "success");
      setVideoToDelete(null);
    },
    onError: (error: AxiosError<{ message: string }>) => {
      show(
        error.response?.data.message || "Failed to delete video",
        "error"
      );
    },
  });

  useEffect(() => {
    if (course) {
      setEditableCourse(course);
    }
    const savedChapters = localStorage.getItem(`chapters_${id}`);
    if (savedChapters) {
      setChapters(JSON.parse(savedChapters));
    }
  }, [id, course]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
      setChapterName(e.target.files[0].name);
    }
  };

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src); // Clean up
        resolve(video.duration);
      };

      video.onerror = () => {
        reject(new Error("Error loading video metadata"));
      };

      video.src = URL.createObjectURL(file);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !chapterName) return;
    try {
      const duration = await getVideoDuration(file);
      const { key } = await uploadFile(file, "video", (progress, url) => {
        setProgress(progress);
        if (url && progress === 100) {
          setProgress(100);
        }
      });

      uploadVideoMutation({
        courseId: course?._id || "",
        duration, // Set the actual duration
        name: chapterName,
        videoUrl: key,
      });
    } catch (error) {
      console.error("Error getting video duration:", error);
    }
  };

  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setEditableCourse((prev) => (prev ? { ...prev, [name]: value } : prev));
  };

  const handleSave = () => {
    if (!editableCourse) return;
    updateCourseMutation(editableCourse);
  };

  const handleEditVideoClick = (video: TCourseVideo) => {
    setEditingVideo(video);
    setEditingVideoName(video.name);
    openEditVideoModal();
  };

  const handleSaveVideoEdit = () => {
    if (!editingVideo || !editingVideoName.trim()) return;
    updateVideoMutation({
      videoId: editingVideo._id,
      name: editingVideoName.trim(),
    });
  };

  const handleDeleteVideoClick = (video: TCourseVideo) => {
    setVideoToDelete(video);
    openDeleteVideoModal();
  };

  const handleConfirmDeleteVideo = () => {
    if (!videoToDelete) return;
    deleteVideoMutation(videoToDelete._id);
  };

  const isSubmittingVideo = isUploading || isRegisteringVideo;

  if (!course) {
    return <div></div>;
  }

  return (
    <div className="max-w-3xl space-y-4 mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{editableCourse?.title}</h2>
        <PrimaryButton
          label="Edit Course"
          // className="px-6 py-4 bg-yellow-600"
          onclick={onOpen}
        />
      </div>
      <img
        src={getUniversityAssetUrl(editableCourse?.image)}
        alt={editableCourse?.title}
        className="w-full h-64 object-cover rounded-lg mb-4"
      />
      <p className="text-gray-300 mb-4">{editableCourse?.description}</p>
      <div className="grid grid-cols-2 gap-4 mb-6"></div>

      <Card>
        <CardHeader>Upload new Video</CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Input
                id="chapterName"
                label="Video title:"
                type="text"
                placeholder="Enter video title"
                labelPlacement="outside"
                value={chapterName}
                onChange={(e) => setChapterName(e.target.value)}
                isDisabled={isSubmittingVideo}
                required
              />
            </div>

            <div>
              <label htmlFor="videoFile" className="block mb-2">
                Video File:
              </label>
              <input
                id="videoFile"
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                disabled={isSubmittingVideo}
                className="w-full px-3 py-2 border rounded-md disabled:opacity-50"
                required
              />
            </div>

            {isSubmittingVideo && (
              <div className="space-y-2 bg-default-100 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">
                    {isUploading
                      ? "Uploading video..."
                      : "Finalizing upload..."}
                  </span>
                  <span className="text-sm text-primary font-bold">
                    {progress}%
                  </span>
                </div>
                <Progress
                  value={progress}
                  className="w-full"
                  color="primary"
                  aria-label="Video upload progress"
                />
              </div>
            )}

            <Button
              color="primary"
              type="submit"
              isDisabled={isSubmittingVideo}
              className="w-full  text-white font-bold py-2 px-4 rounded"
            >
              {isUploading
                ? `${progress}% Uploading`
                : isRegisteringVideo
                ? "Finalizing..."
                : "Upload video"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 ">
        {courseVideos?.map((video) => (
          <Card key={video._id} className="">
            <CardHeader className="flex justify-between items-center gap-2">
              <span className="truncate">{video.name}</span>
              <div className="flex gap-2 shrink-0">
                <Button
                  isIconOnly
                  size="sm"
                  radius="sm"
                  className="bg-green-600 text-white"
                  onPress={() => handleEditVideoClick(video)}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  radius="sm"
                  className="bg-red-700 text-white"
                  onPress={() => handleDeleteVideoClick(video)}
                >
                  <Trash size={16} />
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              <video controls className="w-full h-64 object-cover rounded-lg">
                <source src={getUniversityAssetUrl(video.videoUrl)} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </CardBody>
          </Card>
        ))}
      </div>
      <Modal
        isDismissable={false}
        isKeyboardDismissDisabled={true}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <h3 className="text-xl font-bold">Edit Course Details</h3>
              </ModalHeader>
              <ModalBody>
                <Input
                  label="Title"
                  name="title"
                  fullWidth
                  value={editableCourse?.title}
                  onChange={handleEditChange}
                />
                <Input
                  label="Image URL"
                  name="image"
                  fullWidth
                  value={editableCourse?.image}
                  onChange={handleEditChange}
                />
                <Textarea
                  label="Description"
                  name="description"
                  fullWidth
                  value={editableCourse?.description}
                  onChange={handleEditChange}
                />
              </ModalBody>
              <ModalFooter>
                <Button onPress={onClose}>Cancel</Button>
                <Button
                  color="primary"
                  isDisabled={isSavingCourse}
                  onPress={() => {
                    handleSave();
                    onClose();
                  }}
                >
                  {isSavingCourse ? "Saving..." : "Save"}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Edit Video Modal */}
      <Modal isOpen={isEditVideoModalOpen} onOpenChange={onEditVideoModalOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <h3 className="text-xl font-bold">Edit Video</h3>
              </ModalHeader>
              <ModalBody>
                <Input
                  label="Video title"
                  fullWidth
                  value={editingVideoName}
                  onChange={(e) => setEditingVideoName(e.target.value)}
                />
              </ModalBody>
              <ModalFooter>
                <Button onPress={onClose}>Cancel</Button>
                <Button
                  color="primary"
                  onPress={() => {
                    handleSaveVideoEdit();
                    onClose();
                  }}
                >
                  Save
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete Video Confirmation Modal */}
      <Modal isOpen={isDeleteVideoModalOpen} onOpenChange={onDeleteVideoModalOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Confirm Deletion</ModalHeader>
              <ModalBody>
                <p>
                  Are you sure you want to delete{" "}
                  <span className="font-semibold">{videoToDelete?.name}</span>
                  ? This action cannot be undone.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button onPress={onClose}>Cancel</Button>
                <Button
                  color="danger"
                  onPress={() => {
                    handleConfirmDeleteVideo();
                    onClose();
                  }}
                >
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default CourseDetail;
