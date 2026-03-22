import Header from '@/components/layout/Header';
import MessagesInbox from '@/components/messages/MessagesInbox';

export default function MessagesPage() {
  return (
    <div>
      <Header
        title="Messages"
        subtitle="View and manage lead conversations by LinkedIn account"
      />
      <div className="p-8">
        <MessagesInbox />
      </div>
    </div>
  );
}
