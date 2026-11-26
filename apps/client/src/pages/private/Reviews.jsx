import { useCallback, useEffect, useState } from "react";

import { RefreshCcw, Search } from "lucide-react";

import FormField from "../../components/ui/FormField";
import PageHeader from "../../components/ui/PageHeader";
import Pagination from "../../components/ui/Pagination";
import CustomInput from "../../components/ui/CustomInput";
import CustomSelect from "../../components/ui/CustomSelect";
import CustomButton from "../../components/ui/CustomButton";

import { formatDateInAlphaNumericWithTime } from "../../utils/dateAndTime";

import { reviewsEndpoints } from "../../services/reviews.service";

import useApi from "../../hooks/useApi";
import useListParams from "../../hooks/useListParams";

import { useNotify } from "../../context/notification/useNotify";
import { useLocation } from "../../context/location/useLocation";
import ReviewCard from "../../components/ReviewCard";
import { Skeleton } from "antd";

const STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Replied", value: "replied" },
  { label: "Unreplied", value: "unreplied" },
];

const Reviews = () => {
  const { notify } = useNotify();
  const { activeLocation, locations, setDisbledLocationUpdate } = useLocation();

  const { loading, callApi } = useApi({ reviewsLoading: true });

  const [totalPages, setTotalPages] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [lastSyncByLocation, setLastSyncByLocation] = useState({});

  const {
    params,
    draftParams,
    getParams,
    changeParams,
    changeDraftParam,
    applyDraftParams,
  } = useListParams(
    {
      keyword: null,
      status: "all",
      page: 1,
      perPage: 5,
    },
    { syncWithUrl: true, urlKeys: ["keyword", "status", "page"] },
  );

  const activeLocationDetails = locations?.find(
    (location) =>
      location?.id === activeLocation || location?.value === activeLocation,
  );
  const lastSyncedAt =
    lastSyncByLocation[activeLocation] ||
    activeLocationDetails?.post_sync?.last_success_at;

  const fetchReviews = useCallback(() => {
    const apiParams = { locationId: activeLocation, ...getParams() };

    return callApi("reviewsLoading", () => reviewsEndpoints.getReviews(apiParams), {
      loading: false,
      onSuccess: ({ data }) => {
        setReviews(data?.reviews || []);
        setTotalPages(data?.pagination?.totalPages);
      },
    });
  }, [callApi, activeLocation, getParams]);

  const syncReviews = async () => {
    if (!activeLocation) return;
    setDisbledLocationUpdate(true);

    callApi(
      "syncingReviews",
      () => reviewsEndpoints.syncReviews({ locationId: activeLocation }),
      {
        onSuccess: ({ data }) => {
          if (data?.since) {
            setLastSyncByLocation((prev) => ({
              ...prev,
              [activeLocation]: data.since,
            }));
          }

          notify.msgSuccess(`Reviews synced!`);
          fetchReviews();
        },
        onError: (error) => {
          notify.msgError(
            error?.message ||
              error?.errors?.[0]?.message ||
              "Reviews could not be synchronized. Please try again.",
          );
        },
        atLast: () => {
          setDisbledLocationUpdate(false);
        },
      },
    );
  };

  useEffect(() => {
    fetchReviews();
  }, [
    fetchReviews,
    activeLocation,
    params?.keyword,
    params?.status,
    params?.page,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchReviews();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchReviews]);

  return (
    <div className="flex flex-col gap-6 text-sm">
      <PageHeader
        heading="Reviews"
        subHeading="Sync Google Business Profile reviews and reply"
      >
        <CustomButton
          icon={RefreshCcw}
          variant="purple_white"
          name="Sync Reviews"
          onClick={syncReviews}
          loading={loading?.syncingReviews}
          disabled={!activeLocation}
        />
      </PageHeader>

      {/* Filters */}
      <div className="p-6 grid grid-cols-12 gap-6 border border-gray-300 rounded-xl">
        {/* Post Status Options */}
        <FormField
          id="status"
          label="Status"
          colSpan="col-span-12 lg:col-span-6"
        >
          <CustomSelect
            id="status"
            placeholder="Select Range"
            value={params?.status}
            options={STATUS_OPTIONS}
            onChange={(value) => changeParams("status", value)}
          />
        </FormField>

        <div className="col-span-12 md:col-span-6 self-center">
          <span className="font-medium">Last synced: </span>
          <span>{formatDateInAlphaNumericWithTime(lastSyncedAt) || "-"}</span>
        </div>

        <div className="col-span-12">
          <CustomInput
            icon={Search}
            type="search"
            className=""
            placeholder="Search Keywords"
            value={draftParams?.keyword}
            onChange={(e) => changeDraftParam("keyword", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyDraftParams(["keyword"]);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {loading?.reviewsLoading ? (
          <Skeleton active />
        ) : (
          reviews?.map((review) => (
            <ReviewCard
              key={review?.id}
              review={review}
              onReply={fetchReviews}
            />
          ))
        )}
      </div>

      <Pagination
        currentPage={params?.page}
        totalPages={totalPages}
        onPageChange={(currentPage) => changeParams("page", currentPage)}
      />
    </div>
  );
};

export default Reviews;
