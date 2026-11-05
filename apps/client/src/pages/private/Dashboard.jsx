import { useState } from "react";

import FormField from "../../components/ui/FormField";
import useLocations from "../../hooks/useLocations";
import CustomSelect from "../../components/ui/CustomSelect";

const Dashboard = () => {
  const { locationsLoading, locations } = useLocations();

  const [params, setParams] = useState({
    location: "",
  });

  const changeParams = (field, value) => {
    setParams((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div>
      <FormField id="location" label="Active Location" required>
        <CustomSelect
          id="location"
          placeholder="Select Location"
          value={params?.location}
          options={locations}
          onChange={(value) => changeParams(value)}
          loading={locationsLoading}
        />
      </FormField>
    </div>
  );
};

export default Dashboard;
