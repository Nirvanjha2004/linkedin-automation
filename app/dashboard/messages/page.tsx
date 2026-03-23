import { PageHeader } from '@/components/ui/page-header';
import MessagesInbox from '@/components/messages/MessagesInbox';

export default function MessagesPage() {
  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="Messages" subtitle="View and manage lead conversations" />
      <div className="flex-1 min-h-0 p-6">
        <MessagesInbox />
      </div>
    </div>
  );
}
