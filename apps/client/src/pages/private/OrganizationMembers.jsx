import PageHeader from "../../components/ui/PageHeader";

const OrganizationMembers = () => {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        heading="Organization Members"
        subHeading="Search for an existing user to add them to this workspace. Email invitations are not available yet."
      />
    </div>
  );
};

export default OrganizationMembers;
