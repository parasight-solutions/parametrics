import { useCallback, useEffect, useRef, useState } from "react";

import dayjs from "dayjs";
import { RefreshCcw } from "lucide-react";
import { Popover, Skeleton } from "antd";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import FormField from "../../components/ui/FormField";
import PageHeader from "../../components/ui/PageHeader";
import CustomButton from "../../components/ui/CustomButton";
import CustomSelect from "../../components/ui/CustomSelect";
import CustomDatepicker from "../../components/ui/CustomDatepicker";
import CustomRadioButtons from "../../components/ui/CustomRadioButtons";

import {
  formatDateToISO,
  formatDateInAlphaNumericWithTime,
} from "../../utils/dateAndTime";
import {
  exportToPDF,
  exportToCSV,
  exportToImage,
} from "../../utils/exportData";

import { integrationsEndpoints } from "../../services/integrations.service";

import useApi from "../../hooks/useApi";
import useLocations from "../../hooks/useLocations";

import { getActiveLocationId, setActiveLocationId } from "../../session";

const DEFAULT_RANGE = 30;

const RANGE_OPTIONS = [
  { value: 7, label: "7 Days" },
  { value: DEFAULT_RANGE, label: "30 Days" },
  { value: 90, label: "90 Days" },
];

const EXPORT_OPTIONS = ["CSV", "SVG", "PNG", "PDF"];

const CHART_COLORS = ["#4C9AFF", "#FF6B9A", "#9B9BFF", "#6EDC72", "#FFA940"];

const formatDashboardCSV = (details) => {
  const { location, range, metrics = [] } = details;

  const rows = [
    ["ParaMetrics Dashboard Export"],
    ["Location ID", location?.id ?? ""],
    ["Range Start", range?.start ?? ""],
    ["Range End", range?.end ?? ""],
    ["Days", range?.days ?? ""],
    [],
    ["Totals"],
    ["Metric", "Total"],
  ];

  metrics.forEach(({ metric, total }) => {
    rows.push([metric, total ?? 0]);
  });

  rows.push([]);
  rows.push(["Daily Points"]);

  const metricNames = metrics.map(({ metric }) => metric);

  rows.push(["Date", ...metricNames]);

  const dailyData = new Map();

  metrics.forEach(({ metric, points = [] }) => {
    points.forEach(({ date, value }) => {
      if (!dailyData.has(date)) {
        dailyData.set(date, {});
      }

      dailyData.get(date)[metric] = value ?? 0;
    });
  });

  [...dailyData.keys()].sort().forEach((date) => {
    const values = dailyData.get(date);

    rows.push([date, ...metricNames.map((metric) => values[metric] ?? 0)]);
  });

  return rows;
};

const Dashboard = () => {
  const { loading, callApi } = useApi();
  const { locationsLoading, locations } = useLocations();

  const today = dayjs();
  const detailsLoading = loading?.detailsLoading;

  const graphRef = useRef();

  const [details, setDetails] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const getRangeForStartDate = (days) =>
    formatDateToISO(today.subtract(days - 1, "day"));

  const [params, setParams] = useState({
    locationId: getActiveLocationId(),
    startDate: getRangeForStartDate(DEFAULT_RANGE),
    endDate: formatDateToISO(today),
    range: DEFAULT_RANGE,
  });

  const graphName = `Parametrics Dashboard metrics form ${params.startDate} to ${params.endDate} on ${formatDateInAlphaNumericWithTime(lastUpdated)}`;

  const changeParams = (field, value) => {
    if (detailsLoading) return;

    // Quick range selected
    if (field === "range") {
      const days = Number(value);

      if (!RANGE_OPTIONS.some((option) => option.value === days)) {
        return;
      }

      setParams((prev) => ({
        ...prev,
        range: days,
        startDate: getRangeForStartDate(days),
        endDate: formatDateToISO(today),
      }));
    }

    // Manual date change clears the selected quick range
    else if (field === "startDate" || field === "endDate") {
      setParams((prev) => ({
        ...prev,
        [field]: value,
        range: "",
      }));
    }

    // Other fields, such as locationId
    else {
      if (field === "locationId") {
        setActiveLocationId(value);
      }

      setParams((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
  };

  const fetchPerformanceSeries = useCallback(() => {
    if (!params?.locationId) return;

    const apiParams = { ...params };
    delete apiParams.range;

    callApi(
      "detailsLoading",
      () => integrationsEndpoints.getPerformanceSeries(apiParams),
      {
        onSuccess: ({ data }) => {
          setDetails(data);
          setLastUpdated(dayjs());
        },
      },
    );
  }, [callApi, params, setDetails, setLastUpdated]);

  const handleExport = async (type) => {
    if (detailsLoading || !details?.metrics?.length) return;

    try {
      switch (type) {
        case "CSV": {
          const csvData = formatDashboardCSV(details);
          exportToCSV(csvData, graphName);
          break;
        }

        case "SVG":
        case "PNG": {
          await exportToImage(graphRef, graphName, type.toLowerCase());
          break;
        }

        case "PDF":
          await exportToPDF(graphRef, graphName);
          break;

        default:
          throw new Error(`Unsupported export type: ${type}`);
      }
    } catch (error) {
      console.error(`${type} export failed:`, error);
    }
  };

  useEffect(() => {
    fetchPerformanceSeries();
  }, [fetchPerformanceSeries]);

  return (
    <div className="flex flex-col gap-6 text-sm">
      <PageHeader
        heading="Dashboard"
        subHeading="Google Business Profile performance"
      />

      {/* Filters */}
      <div className="p-6 grid grid-cols-12 gap-6 border border-gray-300 rounded-xl">
        <FormField
          id="locationId"
          label="Active Location"
          colSpan="col-span-12"
          error={!params.locationId && "Select Location"}
          required
        >
          <CustomSelect
            id="locationId"
            placeholder="Select Location"
            value={params?.locationId}
            options={locations}
            onChange={(value) => changeParams("locationId", value)}
            loading={locationsLoading}
          />
        </FormField>

        <FormField
          id="range"
          label="Quick Range"
          colSpan="col-span-12 lg:col-span-4"
        >
          <CustomRadioButtons
            id="range"
            value={params?.range}
            options={RANGE_OPTIONS}
            onChange={(value) => changeParams("range", value)}
          />
        </FormField>

        <FormField
          id="startDate"
          label="Start Date"
          colSpan="col-span-12 lg:col-span-4"
          required
        >
          <CustomDatepicker
            id="startDate"
            max={today.format("YYYY-MM-DD")}
            value={params?.startDate}
            onChange={(e) => changeParams("startDate", e.target.value)}
          />
        </FormField>

        <FormField
          id="endDate"
          label="End Date"
          colSpan="col-span-12 lg:col-span-4"
          required
        >
          <CustomDatepicker
            id="endDate"
            min={dayjs(params?.startDate).format("YYYY-MM-DD")}
            max={today.format("YYYY-MM-DD")}
            value={params?.endDate}
            onChange={(e) => changeParams("endDate", e.target.value)}
          />
        </FormField>

        <div className="col-span-12 border-b border-gray-300"></div>

        <div className="col-span-12 md:col-span-6 self-center">
          <span className="font-medium">Last updated: </span>
          <span>{formatDateInAlphaNumericWithTime(lastUpdated)}</span>
        </div>

        {/* Action Buttons */}
        <div className="col-span-12 md:col-span-6 flex items-center justify-end gap-3">
          <CustomButton
            icon={RefreshCcw}
            name="Refresh"
            onClick={fetchPerformanceSeries}
            loading={detailsLoading}
          />

          <Popover
            content={
              <div className="p-2 w-[150px] flex flex-col gap-1">
                {EXPORT_OPTIONS.map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={detailsLoading || !details?.metrics?.length}
                    onClick={() => handleExport(type)}
                    className="px-3 py-1.5 font-medium text-left text-sm bg-gray-100 hover:bg-gray-200 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {type}
                  </button>
                ))}
              </div>
            }
            styles={{
              container: {
                padding: 0,
              },
            }}
            trigger="click"
          >
            <CustomButton
              name="Export"
              disabled={detailsLoading || !details?.metrics?.length}
            />
          </Popover>
        </div>
      </div>

      {/* Graph */}
      <div ref={graphRef} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {detailsLoading && !details?.metrics?.length ? (
          <>
            <Skeleton.Node active style={{ height: "250px", width: "100%" }} />
            <Skeleton.Node active style={{ height: "250px", width: "100%" }} />
          </>
        ) : (
          details?.metrics?.map(({ metric, total, points }, idx) => (
            <div
              key={metric}
              className="p-6 border border-gray-300 rounded-xl min-w-0"
            >
              <div className="flex items-center justify-between mb-6 gap-4">
                <h3 className="text-base font-semibold text-gray-800">
                  {metric.replaceAll("_", " ")}
                </h3>

                <span className="text-2xl font-bold text-gray-900">
                  {total?.toLocaleString() ?? 0}
                </span>
              </div>

              <div className="w-full h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={points ?? []}
                    margin={{
                      top: 10,
                      right: 20,
                      left: 0,
                      bottom: 10,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e5e7eb"
                    />

                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => dayjs(date).format("DD MMM")}
                      tick={{ fill: "#64748b", fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={20}
                    />

                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "#64748b", fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />

                    <Tooltip
                      labelFormatter={(date) =>
                        dayjs(date).format("DD MMM YYYY")
                      }
                      formatter={(value) => [
                        value,
                        metric.replaceAll("_", " "),
                      ]}
                    />

                    <Line
                      type="monotone"
                      dataKey="value"
                      name={metric.replaceAll("_", " ")}
                      stroke={CHART_COLORS[idx] || "#2563eb"}
                      dot={false}
                      strokeWidth={2}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Dashboard;
