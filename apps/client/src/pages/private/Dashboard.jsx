import { useState } from "react";

import dayjs from "dayjs";

import FormField from "../../components/ui/FormField";
import CustomSelect from "../../components/ui/CustomSelect";
import CustomDatepicker from "../../components/ui/CustomDatepicker";
import CustomRadioButtons from "../../components/ui/CustomRadioButtons";

import { formatDateToISO } from "../../utils/dateAndTime";

import useLocations from "../../hooks/useLocations";
import PageHeader from "../../components/ui/PageHeader";

const RANGE_OPTIONS = [
  { value: 7, label: "7 Days" },
  { value: 30, label: "30 Days" },
  { value: 90, label: "90 Days" },
];

const Dashboard = () => {
  const { locationsLoading, locations } = useLocations();

  const today = dayjs();

  const [params, setParams] = useState({
    location: "",
    startDate: formatDateToISO(today),
    endDate: formatDateToISO(today),
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
          startDate: formatDateToISO(today.subtract(days - 1, "day")),
          endDate: formatDateToISO(today),
        };
      }

      // Manual date change clears the selected quick range
      if (field === "startDate" || field === "endDate") {
        return {
          ...prev,
          [field]: value,
          range: "",
        };
      }

      // Other fields, such as location
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Dashboard"
        subHeading="Google Business Profile performance"
      />

      <div className="p-6 grid grid-cols-2 gap-6 border border-gray-300 rounded-xl">
        <FormField id="location" label="Active Location" required>
          <CustomSelect
            id="location"
            placeholder="Select Location"
            value={params?.location}
            options={locations}
            onChange={(value) => changeParams("location", value)}
            loading={locationsLoading}
          />
        </FormField>

        <FormField id="range" label="Ouick Range">
          <CustomRadioButtons
            id="range"
            value={params?.range}
            options={RANGE_OPTIONS}
            onChange={(value) => changeParams("range", value)}
          />
        </FormField>

        <FormField id="startDate" label="Start Date" required>
          <CustomDatepicker
            id="startDate"
            value={params?.startDate}
            onChange={(e) => changeParams("startDate", e.target.value)}
          />
        </FormField>

        <FormField id="endDate" label="End Date" required>
          <CustomDatepicker
            id="endDate"
            value={params?.endDate}
            onChange={(e) => changeParams("endDate", e.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
};

export default Dashboard;
