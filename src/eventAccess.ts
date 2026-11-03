export type EventSection = 'overview' | 'entry' | 'tickets' | 'team';

export function eventAccess(organizationRoles: string[], eventRoles: string[]) {
  const organizationAdmin = organizationRoles.some(role => role === 'owner' || role === 'admin');
  const admin = organizationAdmin || eventRoles.includes('admin');
  const supervisor = admin || eventRoles.includes('supervisor');
  const scanner = supervisor || eventRoles.includes('scanner');
  const sections: EventSection[] = ['overview'];
  if (scanner) sections.push('entry');
  if (supervisor) sections.push('tickets');
  if (organizationAdmin) sections.push('team');
  return { admin, supervisor, scanner, organizationAdmin, sections,
    defaultSection: (scanner && !supervisor ? 'entry' : 'overview') as EventSection,
    label: organizationRoles.includes('owner') ? 'Propietario' : admin ? 'Administrador' : supervisor ? 'Supervisor' : scanner ? 'Personal de puerta' : 'Miembro',
  };
}
