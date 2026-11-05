import { useCallback, useEffect, useState } from "react";

import dayjs from "dayjs";
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
import CustomSelect from "../../components/ui/CustomSelect";
import CustomDatepicker from "../../components/ui/CustomDatepicker";
import CustomRadioButtons from "../../components/ui/CustomRadioButtons";

import {
  formatDateInAlphaNumericWithTime,
  formatDateToISO,
} from "../../utils/dateAndTime";

import useApi from "../../hooks/useApi";
import useLocations from "../../hooks/useLocations";

import { integrationsEndpoints } from "../../services/integrations.service";
import CustomButton from "../../components/ui/CustomButton";
import { RefreshCcw } from "lucide-react";

const RANGE_OPTIONS = [
  { value: 7, label: "7 Days" },
  { value: 30, label: "30 Days" },
  { value: 90, label: "90 Days" },
];

const CHART_COLORS = ["#4C9AFF", "#FF6B9A", "#9B9BFF", "#6EDC72", "#FFA940"];

const Dashboard = () => {
  const { loading, callApi } = useApi({ metricsLoading: true });
  const { locationsLoading, locations } = useLocations();

  const today = dayjs();
  const metricsLoading = loading?.metricsLoading;

  const [metrics, setMetrics] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [params, setParams] = useState({
    locationId: "",
    start: formatDateToISO(today),
    end: formatDateToISO(today),
    range: "",
  });

  const changeParams = (field, value) => {
    setParams((prev) => {
      // Quick range selected
      if (field === "range") {
        const days = Number(value);

        if (!RANGE_OPTIONS.some((option) => option.value === days)) {
          return prev;
        }

        return {
          ...prev,
          range: days,
          start: formatDateToISO(today.subtract(days - 1, "day")),
          end: formatDateToISO(today),
        };
      }

      // Manual date change clears the selected quick range
      if (field === "start" || field === "end") {
        return {
          ...prev,
          [field]: value,
          range: "",
        };
      }

      // Other fields, such as locationId
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const fetchPerformanceSeries = useCallback(() => {
    const apiParams = { ...params };
    delete apiParams.range;

    callApi(
      "metricsLoading",
      () => integrationsEndpoints.getPerformanceSeries(apiParams),
      {
        onSuccess: ({ data }) => {
          setMetrics(data?.metrics);
          setLastUpdated(dayjs());
        },
      },
    );
  }, [callApi, params, setMetrics, setLastUpdated]);

  useEffect(() => {
    fetchPerformanceSeries();
  }, [fetchPerformanceSeries]);

  return (
    <div className="flex flex-col gap-6 text-sm">
      <PageHeader
        heading="Dashboard"
        subHeading="Google Business Profile performance"
      />

      <div className="p-6 grid grid-cols-12 gap-6 border border-gray-300 rounded-xl">
        <FormField
          id="locationId"
          label="Active Location"
          colSpan="col-span-12"
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

        <FormField id="range" label="Ouick Range" colSpan="col-span-4">
          <CustomRadioButtons
            id="range"
            value={params?.range}
            options={RANGE_OPTIONS}
            onChange={(value) => changeParams("range", value)}
          />
        </FormField>

        <FormField id="start" label="Start Date" colSpan="col-span-4" required>
          <CustomDatepicker
            id="start"
            value={params?.start}
            onChange={(e) => changeParams("start", e.target.value)}
          />
        </FormField>

        <FormField id="end" label="End Date" colSpan="col-span-4" required>
          <CustomDatepicker
            id="end"
            value={params?.end}
            onChange={(e) => changeParams("end", e.target.value)}
          />
        </FormField>

        <div className="col-span-6 self-center">
          <span className="font-medium">Last updated: </span>
          <span>{formatDateInAlphaNumericWithTime(lastUpdated)}</span>
        </div>

        {/* Action Buttons */}
        <div className="col-span-6 flex items-center justify-end gap-3">
          <CustomButton
            icon={RefreshCcw}
            name="Refresh"
            onClick={fetchPerformanceSeries}
            loading={metricsLoading}
          />
          <CustomButton name="Report" disabled={metricsLoading} />
          <CustomButton name="Export" disabled={metricsLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metrics.map(({ metric, total, points }, idx) => (
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
                    labelFormatter={(date) => dayjs(date).format("DD MMM YYYY")}
                    formatter={(value) => [value, metric.replaceAll("_", " ")]}
                  />

                  <Line
                    type="monotone"
                    dataKey="value"
                    name={metric.replaceAll("_", " ")}
                    stroke={CHART_COLORS[idx] || "2563eb"}
                    dot={false}
                    strokeWidth={2}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* {metricsLoading ? (
        <div>Loading...</div>
      ) : (
        <div className="p-6 border border-gray-300 rounded-xl">
          <p className="mb-4">Raw Totals</p>

          <table
            className="w-full
            [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-[#64748B] [&_th]:whitespace-nowrap
            [&_td]:px-4 [&_td]:py-2 [&_td]:text-left [&_td]:whitespace-nowrap"
          >
            <thead>
              <tr>
                <th>Metric</th>
                <th>Total</th>
              </tr>
            </thead>

            <tbody>
              {metrics?.map((data) => {
                const { metric, total } = data || {};

                return (
                  <tr>
                    <td>{metric}</td>
                    <td>{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )} */}
    </div>
  );
};

export default Dashboard;
