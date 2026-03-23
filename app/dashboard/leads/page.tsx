import { PageHeader } from '@/components/ui/page-header';
import LeadTable from '@/components/leads/LeadTable';

export default function LeadsPage() {
  return (
    <div>
      <PageHeader title="All Leads" subtitle="View and manage leads across all campaigns" />
      <div className="p-8">
        <LeadTable />
      </div>
    </div>
  );
}
