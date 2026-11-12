import { useCallback, useEffect, useState } from "react";

import { FilePenLine, RefreshCcw, Search, Trash2 } from "lucide-react";

import DataTable from "../../components/DataTable";

import Badge from "../../components/ui/Badge";
import FormField from "../../components/ui/FormField";
import PageHeader from "../../components/ui/PageHeader";
import Pagination from "../../components/ui/Pagination";
import CustomInput from "../../components/ui/CustomInput";
import CustomSelect from "../../components/ui/CustomSelect";
import ActionButton from "../../components/ui/ActionButton";
import CustomCheckbox from "../../components/ui/CustomCheckbox";

import { formatDateInAlphaNumericWithTime } from "../../utils/dateAndTime";

import useApi from "../../hooks/useApi";
import useLocations from "../../hooks/useLocations";
import useListParams from "../../hooks/useListParams";

import { postsEndpoints } from "../../services/posts.service";

import { BADGE_STATUS_COLORS } from "../../constant";
import { getActiveLocationId, setActiveLocationId } from "../../session";

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
  const { loading, callApi } = useApi({ postsLoading: true });
  const { locationsLoading, locations } = useLocations();

  const [totalPages, setTotalPages] = useState(0);
  const [posts, setPosts] = useState([]);

  const {
    params,
    draftParams,
    getParams,
    changeParams,
    changeDraftParam,
    applyDraftParams,
  } = useListParams(
    {
      locationId: getActiveLocationId(),
      keyword: null,
      status: "all",
      showAll: false,
      page: 1,
      perPage: 5,
    },
    { syncWithUrl: true, urlKeys: ["keyword", "status", "locationId", "page"] },
  );

  const fetchPosts = useCallback(() => {
    const apiParams = { ...getParams() };
    if (getParams()?.showAll) {
      delete apiParams.locationId;
    }
    delete apiParams.showAll;

    callApi("postsLoading", () => postsEndpoints.getPosts(apiParams), {
      onSuccess: ({ data }) => {
        setPosts(data?.posts || []);
        setTotalPages(data?.pagination?.totalPages);
      },
    });
  }, [callApi, getParams]);

  useEffect(() => {
    fetchPosts();
  }, [
    fetchPosts,
    params?.keyword,
    params?.locationId,
    params?.status,
    params?.showAll,
    params?.page,
  ]);

  const tableHeading = [
    { label: "Summary" },
    { label: "Location" },
    { label: "Status" },
    { label: "Scheduled" },
    { label: "Provider Ref" },
    { label: "Error" },
    { label: "Actions" },
  ];

  const tableBody = posts?.map((post) => {
    const {
      summary,
      status,
      scheduled_at,
      location,
      provider_post_name,
      provider_error,
    } = post || {};
    const { title } = location || {};

    const isPublished = status === "published";
    const isDraft = status === "draft";

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
        <div className="max-w-120 text-wrap line-clamp-6 truncate break-all">
          {provider_post_name || "-"}
        </div>,
        <div className="max-w-120 text-wrap line-clamp-6 truncate">
          {provider_error || "-"}
        </div>,
        <div className="flex flex-col gap-1">
          <ActionButton
            title="Edit"
            variant="green"
            icon={FilePenLine}
            disabled={isPublished}
          />

          <ActionButton title="Delete" variant="red" icon={Trash2} />

          <ActionButton
            title="Retry"
            variant="purple"
            icon={RefreshCcw}
            disabled={isPublished || isDraft}
          />
        </div>,
      ],
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Posts"
        subHeading="Create and publish Google Business Profile updates"
      />

      <div className="p-6 grid grid-cols-12 gap-6 border border-gray-300 rounded-xl">
        <FormField
          id="locationId"
          label="Active Location"
          colSpan="col-span-12 lg:col-span-6"
          error={!params.locationId && "Select Location"}
          required
        >
          <CustomSelect
            id="locationId"
            placeholder="Select Location"
            value={params?.locationId}
            options={locations}
            onChange={(value) => {
              changeParams("locationId", value);
              setActiveLocationId(value);
            }}
            loading={locationsLoading}
          />
        </FormField>

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

        <FormField
          id="showAll"
          label="Show All Locations"
          colSpan="mt-2 col-span-12 lg:col-span-6"
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

        {/* <div className="col-span-12 lg:col-span-6">
          <div className="p-1 h-full w-fit flex items-center justify-between gap-1 bg-gray-100 rounded-full">
            {[
              { label: "All", value: "" },
              { label: "Scheduled", value: "scheduled" },
              { label: "Queued", value: "queued" },
              { label: "Publishing", value: "publishing" },
              { label: "Published", value: "published" },
              { label: "Failed", value: "failed" },
            ].map(({ label, value }) => {
              const isActive = value === params?.status;

              return (
                <button
                  key={value}
                  onClick={() => changeParams("status", value)}
                  className={`h-full px-3 ${isActive ? "text-white bg-[#7851A9]" : ""} font-medium text-xs text-center rounded-full cursor-pointer`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div> */}
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
