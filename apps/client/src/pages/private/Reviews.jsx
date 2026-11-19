import CustomButton from "../../components/ui/CustomButton";
import PageHeader from "../../components/ui/PageHeader";

const Reviews = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Reviews"
        subHeading="Sync Google Business Profile reviews and reply"
      >
        <CustomButton name="Sync from Google" />
      </PageHeader>
    </div>
  );
};

export default Reviews;
