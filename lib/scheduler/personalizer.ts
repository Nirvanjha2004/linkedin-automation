/**
 * Personalizes a message template by replacing placeholders with lead data.
 * Supports: {{first_name}}, {{last_name}}, {{full_name}}, {{company}}, {{title}}, {{email}}
 */
export function personalizeMessage(
  template: string,
  lead: {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    company?: string | null;
    title?: string | null;
    email?: string | null;
  }
): string {
  if (!template) return template;

  const name = lead.full_name || 
    [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 
    'there';

  return template
    .replace(/\{\{first_name\}\}/gi, lead.first_name || name.split(' ')[0] || 'there')
    .replace(/\{\{last_name\}\}/gi, lead.last_name || '')
    .replace(/\{\{full_name\}\}/gi, name)
    .replace(/\{\{company\}\}/gi, lead.company || 'your company')
    .replace(/\{\{title\}\}/gi, lead.title || 'your role')
    .replace(/\{\{email\}\}/gi, lead.email || '');
}
