import { useState } from "react";

import { Pen, Star } from "lucide-react";

import FormField from "./ui/FormField";
import CustomButton from "./ui/CustomButton";
import CustomTextarea from "./ui/CustomTextarea";

import useApi from "../hooks/useApi";

import { reviewsEndpoints } from "../services/reviews.service";

import { useNotify } from "../context/notification/useNotify";
import ExpandableText from "./ExpandableText";

const STAR_RATING = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

const ReviewCard = ({ review, onReply }) => {
  const { notify } = useNotify();
  const { loading, callApi } = useApi();

  const { id, reviewer, comment, starRating, reviewReply } = review || {};
  const { profilePhotoUrl, displayName } = reviewer || {};

  const rating = STAR_RATING[starRating] ?? 0;
  const ogReply = reviewReply?.comment ?? "";
  const hasReply = Boolean(ogReply.trim());

  const [draftReply, setDraftReply] = useState(null);

  const isReplying = loading?.replying;
  const isEditing = draftReply !== null;
  const isEditable = isEditing || !hasReply;
  const reply = isEditing ? draftReply : ogReply;
  const isUnEdited = !reply.trim() || reply.trim() === ogReply.trim();

  const startEditing = () => {
    setDraftReply(ogReply);
  };

  const cancleEditing = () => {
    setDraftReply(null);
  };

  const handleReplyEdit = (e) => {
    setDraftReply(e.target.value);
  };

  const saveReply = () => {
    if (!id || isUnEdited) return;

    callApi(
      "replying",
      () => reviewsEndpoints.replyToReview(id, { comment: reply.trim() }),
      {
        onSuccess: async (res) => {
          await onReply();
          cancleEditing();
          notify.msgSuccess(res?.message || "Reply posted!");
        },
        onError: (error) => {
          notify.msgError(error?.message || "Error posting reply!");
        },
      },
    );
  };

  return (
    <div className="p-3 flex flex-col gap-3 border border-gray-300 rounded-xl">
      <div className="flex items-center gap-3">
        <img
          src={profilePhotoUrl}
          alt={displayName}
          className="shrink-0 size-8 rounded-full"
        />

        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-base">{displayName}</p>

          <div className="flex items-center gap-1">
            {[...Array(5)].map((_, idx) => {
              const isFilled = idx + 1 <= rating;

              return (
                <Star
                  size={16}
                  className={
                    isFilled
                      ? "text-yellow-400 fill-yellow-400"
                      : "text-gray-300 fill-gray-300"
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      <ExpandableText text={comment} />

      <div className="w-full border-b border-gray-300" />

      <FormField
        id={id}
        label="Reply"
        attachment={
          hasReply && (
            <button
              onClick={isEditing ? cancleEditing : startEditing}
              className="flex items-center gap-1 text-green-500 hover:text-green-600 cursor-pointer"
              disabled={isReplying}
            >
              <Pen size={14} />
              {isEditing ? "Cancle Edit" : "Edit"}
            </button>
          )
        }
        className="px-1"
      >
        <CustomTextarea
          id={id}
          placeholder={`Reply to (${displayName})`}
          value={reply}
          onChange={handleReplyEdit}
          disabled={!isEditable || isReplying}
        />
      </FormField>

      <CustomButton
        onClick={saveReply}
        className="self-end"
        name="Send Reply"
        loading={isReplying}
        disabled={!isEditable || isUnEdited}
      />
    </div>
  );
};

export default ReviewCard;
