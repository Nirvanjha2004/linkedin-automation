import Header from '@/components/layout/Header';
import CampaignForm from '@/components/campaigns/CampaignForm';

export default function NewCampaignPage() {
  return (
    <div>
      <Header
        title="Create Campaign"
        subtitle="Set up a new LinkedIn outreach campaign"
      />
      <div className="p-8 max-w-3xl">
        <CampaignForm />
      </div>
    </div>
  );
}
