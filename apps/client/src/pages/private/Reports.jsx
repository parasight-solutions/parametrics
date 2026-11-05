import PageHeader from "../../components/ui/PageHeader";

const Reports = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Reports"
        subHeading="Read-only listing of generated dashboard snapshot reports. Downloads stream the persisted PDF/XLSX bytes from local storage."
      />
    </div>
  );
};

export default Reports;
