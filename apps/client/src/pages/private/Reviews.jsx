import PageHeader from "../../components/ui/PageHeader";
import CustomButton from "../../components/ui/CustomButton";

const Reviews = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Reviews"
        subHeading="Sync Google Business Profile reviews and reply"
      >
        <CustomButton name="Sync Reviews" />
      </PageHeader>
    </div>
  );
};

export default Reviews;
