import { useCallback, useEffect } from "react";

import dayjs from "dayjs";
import { useNavigate, useParams } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";

import FormField from "../../components/ui/FormField";
import PageHeader from "../../components/ui/PageHeader";
import CustomInput from "../../components/ui/CustomInput";
import CustomSelect from "../../components/ui/CustomSelect";
import CustomButton from "../../components/ui/CustomButton";
import CustomTextarea from "../../components/ui/CustomTextarea";
import CustomTimepicker from "../../components/ui/CustomTimepicker";

import { validateWebsite } from "../../utils/formValidations";

import { postsEndpoints } from "../../services/posts.service";

import useApi from "../../hooks/useApi";
import useLocations from "../../hooks/useLocations";

import { useNotify } from "../../context/notification/useNotify";

import { getActiveLocationId } from "../../session";

const PostFormPage = () => {
  const { notify } = useNotify();

  const navigate = useNavigate();
  const { loading, callApi } = useApi();
  const { locationsLoading, locations } = useLocations();

  const savingPost = loading?.savingPost;

  const { postId } = useParams();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm({
    defaultValues: {
      locationId: getActiveLocationId(),
      imageUrl: null,
      callToActionUrl: null,
      publishNow: true,
    },
    mode: "onChange",
  });

  const fetchPost = useCallback(() => {
    if (!postId) return;

    callApi("postLoading", () => postsEndpoints.getPost(postId), {
      onSuccess: ({ data }) => {
        const { post } = data || {};
        reset({
          ...post,
          scheduleAt: post?.scheduled_at
            ? dayjs(post.scheduled_at).format("YYYY-MM-DDTHH:mm")
            : "",
        });
      },
    });
  }, [callApi, postId, reset]);

  const onSubmit = (data) => {
    const { scheduleAt } = data;
    const payload = {
      ...data,
      scheduleAt: scheduleAt ? dayjs(scheduleAt).toISOString() : null,
      publishNow: scheduleAt ? false : true,
    };

    callApi(
      "savingPost",
      postId
        ? () => postsEndpoints.updatePost(postId, payload)
        : () => postsEndpoints.addPost(payload),
      {
        onSuccess: () => {
          navigate(-1);
          notify.msgSuccess("Post saved!");
        },
        onError: () => {
          notify.msgError("Failed to save post!");
        },
      },
    );
  };

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading={postId ? "Edit Post" : "Add Post"}
        subHeading="Publish an update to a Business Profile location"
      />

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-2 gap-6"
      >
        {/* Location */}
        <FormField
          id="locationId"
          label="Location"
          colSpan="col-span-2 md:col-span-1"
          required
          error={errors.locationId?.message}
        >
          <Controller
            name="locationId"
            control={control}
            rules={{ required: "Location is required!" }}
            render={({ field }) => (
              <CustomSelect
                id="locationId"
                placeholder="Select"
                value={field.value}
                options={locations}
                onChange={field.onChange}
                loading={locationsLoading}
              />
            )}
          />
        </FormField>

        {/* Schedule */}
        <FormField
          id="scheduleAt"
          label="Schedule"
          colSpan="col-span-2 md:col-span-1"
          error={errors.scheduleAt?.message}
        >
          <CustomTimepicker
            id="scheduleAt"
            placeholder="Select Data & Time"
            {...register("scheduleAt")}
          />
        </FormField>

        {/* Summary */}
        <FormField
          id="summary"
          label="Summary"
          className="col-span-2"
          required
          error={errors.summary?.message}
        >
          <CustomTextarea
            id="summary"
            rows={4}
            {...register("summary", {
              required: "Summary is required!",
            })}
          />
        </FormField>

        {/* Image URL */}
        {!postId && (
          <FormField
            id="imageUrl"
            label="Image URL"
            className="col-span-2 md:col-span-1"
            error={errors.imageUrl?.message}
          >
            <CustomInput
              id="imageUrl"
              placeholder="https://"
              {...register("imageUrl", validateWebsite)}
            />
          </FormField>
        )}

        {/* CTA URL */}
        {!postId && (
          <FormField
            id="callToActionUrl"
            label="CTA URL"
            className="col-span-2 md:col-span-1"
            error={errors.callToActionUrl?.message}
          >
            <CustomInput
              id="callToActionUrl"
              placeholder="https://"
              {...register("callToActionUrl", validateWebsite)}
            />
          </FormField>
        )}

        <CustomButton
          className="col-span-2 justify-self-end"
          type="submit"
          name={savingPost ? "Posting..." : "Post Now"}
          loading={savingPost}
        />
      </form>
    </div>
  );
};

export default PostFormPage;
