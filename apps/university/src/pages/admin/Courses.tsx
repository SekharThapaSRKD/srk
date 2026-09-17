import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Card,
  CardBody,
  CardFooter,
  Button,
  Input,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@nextui-org/react";
import { Pencil, Trash } from "lucide-react";
import { PrimaryButton } from "../../components/ReusableComponents";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteCourseApi,
  getAllCoursesApi,
  updateCourseApi,
} from "../../lib/apiClient";
import { TCourse } from "../../lib/types/entities";
import { getUniversityAssetUrl } from "../../lib/cdn";
import useAlert from "../../hooks/useAlert";
import { AxiosError } from "axios";

function CourseList() {
  const { data: courses, refetch } = useQuery<TCourse[] | undefined>({
    queryKey: ["getAllPackages"],
    queryFn: getAllCoursesApi,
  });
  const navigate = useNavigate();
  const { show } = useAlert();
  const { invalidateQueries } = useQueryClient();

  const [editingCourse, setEditingCourse] = useState<TCourse | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<TCourse | null>(null);
  const {
    isOpen: isEditModalOpen,
    onOpen: openEditModal,
    onOpenChange: onEditModalOpenChange,
  } = useDisclosure();
  const {
    isOpen: isDeleteModalOpen,
    onOpen: openDeleteModal,
    onOpenChange: onDeleteModalOpenChange,
  } = useDisclosure();

  const { mutate: updateCourseMutation, isPending: isUpdating } = useMutation(
    {
      mutationFn: async (course: TCourse) => {
        return updateCourseApi(course._id, {
          title: course.title,
          description: course.description,
          image: course.image,
        });
      },
      onSuccess: () => {
        show("Course updated successfully", "success");
        invalidateQueries({ queryKey: ["getAllPackages"] });
        refetch();
        setEditingCourse(null);
      },
      onError: (error: AxiosError<{ message: string }>) => {
        show(error.response?.data.message || "Failed to update course", "error");
      },
    }
  );

  const { mutate: deleteCourseMutation } = useMutation({
    mutationFn: async (courseId: string) => deleteCourseApi(courseId),
    onSuccess: () => {
      show("Course deleted successfully", "success");
      invalidateQueries({ queryKey: ["getAllPackages"] });
      refetch();
      setCourseToDelete(null);
    },
    onError: (error: AxiosError<{ message: string }>) => {
      show(error.response?.data.message || "Failed to delete course", "error");
    },
  });

  const handleNavigateToCourseDetails = (courseId: string): void => {
    navigate(`/admin/courses/${courseId}`);
  };

  const handleEditClick = (course: TCourse) => {
    setEditingCourse(course);
    openEditModal();
  };

  const handleDeleteClick = (course: TCourse) => {
    setCourseToDelete(course);
    openDeleteModal();
  };

  const handleSaveEdit = () => {
    if (!editingCourse) return;
    updateCourseMutation(editingCourse);
  };

  const handleConfirmDelete = () => {
    if (!courseToDelete) return;
    deleteCourseMutation(courseToDelete._id);
  };

  return (
    <div className="w-full">
      <div className="flex space-y-8 justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-textPrimary">Courses</h2>
        <Link to="/admin/courses/create">
          <PrimaryButton label="Create Course" radius="sm" />
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {courses?.map((course) => (
          <div key={course._id} className=" transition-all duration-200">
            <Card
              isPressable
              className="w-full bg-bgSecondary text-textPrimary  h-72"
              onPress={() => handleNavigateToCourseDetails(course._id)}
            >
              <CardBody
                className={`p-0 bg-no-repeat bg-cover bg-center`}
                style={{
                  backgroundImage: `url(${getUniversityAssetUrl(course.image)})`,
                }}
              ></CardBody>
              <CardFooter className="flex-col gap-2 items-start">
                <h4 className="font-bold text-medium mb-1 text-start">
                  {course.title}
                </h4>
                <div
                  className="w-full flex justify-between"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    isIconOnly
                    size="sm"
                    radius="sm"
                    className="bg-green-600 text-white"
                    onPress={() => handleEditClick(course)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    radius="sm"
                    className="bg-red-700 hover:bg-red-800 text-white"
                    onPress={() => handleDeleteClick(course)}
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </div>
        ))}
      </div>

      {/* Edit Course Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onOpenChange={(open) => {
          onEditModalOpenChange();
          if (!open) setEditingCourse(null);
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <h3 className="text-xl font-bold">Edit Course</h3>
              </ModalHeader>
              <ModalBody>
                <Input
                  label="Title"
                  value={editingCourse?.title || ""}
                  onChange={(e) =>
                    setEditingCourse((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev
                    )
                  }
                />
                <Input
                  label="Image URL"
                  value={editingCourse?.image || ""}
                  onChange={(e) =>
                    setEditingCourse((prev) =>
                      prev ? { ...prev, image: e.target.value } : prev
                    )
                  }
                />
                <Textarea
                  label="Description"
                  value={editingCourse?.description || ""}
                  onChange={(e) =>
                    setEditingCourse((prev) =>
                      prev ? { ...prev, description: e.target.value } : prev
                    )
                  }
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  isDisabled={isUpdating}
                  onPress={() => {
                    handleSaveEdit();
                    onClose();
                  }}
                >
                  {isUpdating ? "Saving..." : "Save"}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onOpenChange={(open) => {
          onDeleteModalOpenChange();
          if (!open) setCourseToDelete(null);
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Confirm Deletion</ModalHeader>
              <ModalBody>
                <p>
                  Are you sure you want to delete{" "}
                  <span className="font-semibold">
                    {courseToDelete?.title}
                  </span>
                  ? This will also delete all of its videos. This action
                  cannot be undone.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => {
                    handleConfirmDelete();
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

export default CourseList;
