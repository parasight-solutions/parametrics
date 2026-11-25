import { useCallback, useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";
import {
  FilePenLine,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

import DataTable from "../../components/DataTable";

import Badge from "../../components/ui/Badge";
import FormField from "../../components/ui/FormField";
import PageHeader from "../../components/ui/PageHeader";
import Pagination from "../../components/ui/Pagination";
import CustomInput from "../../components/ui/CustomInput";
import CustomButton from "../../components/ui/CustomButton";
import CustomSelect from "../../components/ui/CustomSelect";
import ActionButton from "../../components/ui/ActionButton";
import CustomCheckbox from "../../components/ui/CustomCheckbox";

import { formatDateInAlphaNumericWithTime } from "../../utils/dateAndTime";
import {
  isProviderPostUrl,
  openProviderPost,
} from "../../utils/providerPostUrl";
import {
  getPostDeleteErrorMessage,
  isPostDeleteDisabled,
} from "../../utils/postDeleteUi";

import useApi from "../../hooks/useApi";
import useListParams from "../../hooks/useListParams";

import { postsEndpoints } from "../../services/posts.service";

import { useNotify } from "../../context/notification/useNotify";
import { useLocation } from "../../context/location/useLocation";

import { BADGE_STATUS_COLORS } from "../../constant";

const STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Queued", value: "queued" },
  { label: "Publishing", value: "publishing" },
  { label: "Published", value: "published" },
  { label: "Failed", value: "failed" },
];

const Posts = () => {
  const { notify } = useNotify();
  const { activeLocation, locations, setDisbledLocationUpdate } = useLocation();

  const navigate = useNavigate();

  const { loading, callApi } = useApi({ postsLoading: true });

  const [totalPages, setTotalPages] = useState(0);
  const [posts, setPosts] = useState([]);
  const [lastSyncByLocation, setLastSyncByLocation] = useState({});

  const [deletingPostIds, setDeletingPostIds] = useState(() => new Set());
  const deletingPostIdsRef = useRef(new Set());

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
      showAll: false,
      page: 1,
      perPage: 5,
    },
    { syncWithUrl: true, urlKeys: ["keyword", "status", "page"] },
  );

  const fetchPosts = useCallback(() => {
    const apiParams = { locationId: activeLocation, ...getParams() };

    if (getParams()?.showAll) {
      delete apiParams.locationId;
    }
    delete apiParams.showAll;

    callApi("postsLoading", () => postsEndpoints.getPosts(apiParams), {
      loading: false,
      onSuccess: ({ data }) => {
        setPosts(data?.posts || []);
        setTotalPages(data?.pagination?.totalPages);
      },
    });
  }, [callApi, activeLocation, getParams]);

  const deletePost = async (postId) => {
    if (deletingPostIdsRef.current.has(postId)) return;

    deletingPostIdsRef.current.add(postId);
    setDeletingPostIds(new Set(deletingPostIdsRef.current));

    callApi(`deleting:${postId}`, () => postsEndpoints.deletePost(postId), {
      onSuccess: () => {
        fetchPosts();
        notify.msgSuccess("Post deleted!");
      },
      onError: (error) => {
        notify.msgError(getPostDeleteErrorMessage(error));
      },
      atLast: () => {
        deletingPostIdsRef.current.delete(postId);
        setDeletingPostIds(new Set(deletingPostIdsRef.current));
      },
    });
  };

  const retryPost = (postId) => {
    callApi("retrying", () => postsEndpoints.retryPost(postId), {
      onSuccess: () => {
        fetchPosts();
        notify.msgSuccess("Retry posting!");
      },
      onError: () => {
        notify.msgSuccess("Failed to retry posting!");
      },
    });
  };

  const syncPosts = async () => {
    if (!activeLocation) return;
    setDisbledLocationUpdate(true);

    callApi(
      "syncingPosts",
      () => postsEndpoints.syncPosts({ locationId: activeLocation }),
      {
        onSuccess: ({ data }) => {
          const summary = data?.summary || {};
          if (data?.lastSyncedAt) {
            setLastSyncByLocation((prev) => ({
              ...prev,
              [activeLocation]: data.lastSyncedAt,
            }));
          }

          notify.msgSuccess(
            `Posts synced: ${summary.inserted || 0} imported, ${summary.updated || 0} updated.`,
          );
          fetchPosts();
        },
        onError: (error) => {
          notify.msgError(
            error?.message ||
              error?.errors?.[0]?.message ||
              "Posts could not be synchronized. Please try again.",
          );
        },
        atLast: () => {
          setDisbledLocationUpdate(false);
        },
      },
    );
  };

  useEffect(() => {
    fetchPosts();
  }, [
    fetchPosts,
    activeLocation,
    params?.keyword,
    params?.status,
    params?.showAll,
    params?.page,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchPosts();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchPosts]);

  const tableHeading = [
    { label: "Summary" },
    { label: "Location" },
    { label: "Status" },
    { label: "Scheduled" },
    { label: "Provider Ref" },
    { label: "Error" },
    { label: "Actions" },
  ];

  const activeLocationDetails = locations?.find(
    (location) =>
      location?.id === activeLocation || location?.value === activeLocation,
  );
  const lastSyncedAt =
    lastSyncByLocation[activeLocation] ||
    activeLocationDetails?.post_sync?.last_success_at;

  const tableBody = posts?.map((post) => {
    const {
      id,
      summary,
      status,
      scheduled_at,
      location,
      provider_post_name,
      provider_post_url,
      provider_error,
    } = post || {};
    const { title } = location || {};

    const isPublished = status === "published";
    const isFailed = status === "failed";
    const isDeleting = deletingPostIds.has(id);
    const hasProviderPostUrl = isProviderPostUrl(provider_post_url);

    return {
      cells: [
        <div className="max-w-120 text-wrap line-clamp-6 truncate">
          {summary}
        </div>,
        <div className="max-w-120 text-wrap line-clamp-6 truncate">
          {title}
        </div>,
        <Badge variant={BADGE_STATUS_COLORS[status]} text={status} />,
        <div className="max-w-120 text-wrap line-clamp-6 truncate">
          {formatDateInAlphaNumericWithTime(scheduled_at) || "-"}
        </div>,
        provider_post_name ? (
          <button
            type="button"
            title={
              hasProviderPostUrl
                ? "Open post on Google"
                : "Public post URL unavailable"
            }
            onClick={() => openProviderPost(provider_post_url)}
            disabled={!hasProviderPostUrl}
            className="max-w-120 text-left text-wrap line-clamp-6 truncate break-all enabled:text-[#7851A9] enabled:hover:underline enabled:cursor-pointer disabled:cursor-default"
          >
            {provider_post_name}
          </button>
        ) : (
          "-"
        ),
        <div className="max-w-120 text-wrap line-clamp-6 truncate">
          {provider_error || "-"}
        </div>,
        <div className="flex flex-col gap-1">
          <ActionButton
            title="Edit"
            variant="green"
            icon={FilePenLine}
            onClick={() => navigate(`${id}/edit`)}
            disabled={isPublished}
          />

          <ActionButton
            title={
              status === "publishing"
                ? "Cannot delete while publishing"
                : isDeleting
                  ? "Deleting"
                  : "Delete"
            }
            variant="red"
            icon={isDeleting ? LoaderCircle : Trash2}
            iconClass={isDeleting ? "animate-spin" : ""}
            onClick={() => deletePost(id)}
            disabled={isPostDeleteDisabled({
              status,
              postId: id,
              deletingPostIds,
            })}
          />

          <ActionButton
            title="Retry"
            variant="purple"
            icon={RefreshCcw}
            onClick={() => retryPost(id)}
            disabled={!isFailed}
          />
        </div>,
      ],
    };
  });

  return (
    <div className="flex flex-col gap-6 text-sm">
      <PageHeader
        heading="Posts"
        subHeading="Create and publish Google Business Profile updates"
      >
        <div className="flex items-center justify-end gap-3">
          <CustomButton
            icon={RefreshCcw}
            variant="purple_white"
            name="Sync Posts"
            onClick={syncPosts}
            loading={loading?.syncingPosts}
            disabled={!activeLocation}
          />

          <CustomButton
            icon={Plus}
            name="New Post"
            onClick={() => navigate("add")}
          />
        </div>
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

        {/* Show All */}
        <FormField
          id="showAll"
          label="Show All Locations"
          colSpan="lg:mt-8 col-span-12 lg:col-span-6"
          type="checkbox"
        >
          <CustomCheckbox
            id="showAll"
            checked={params?.showAll}
            onChange={(e) =>
              changeParams("showAll", e.target.checked ? true : false)
            }
          />
        </FormField>

        <div className="col-span-12 lg:col-span-6">
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

        <div className="col-span-12 md:col-span-6 self-center">
          <span className="font-medium">Last synced: </span>
          <span>{formatDateInAlphaNumericWithTime(lastSyncedAt) || "-"}</span>
        </div>
      </div>

      <DataTable
        loading={loading?.postsLoading}
        tableHeading={tableHeading}
        tableBody={tableBody}
      />

      <Pagination
        currentPage={params?.page}
        totalPages={totalPages}
        onPageChange={(currentPage) => changeParams("page", currentPage)}
      />
    </div>
  );
};

export default Posts;
