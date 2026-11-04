export type EventSection = 'overview' | 'entry' | 'door' | 'tickets' | 'finances' | 'team';

export function eventAccess(organizationRoles: string[], eventRoles: string[]) {
  const organizationAdmin = organizationRoles.some(role => role === 'owner' || role === 'admin');
  const admin = organizationAdmin || eventRoles.includes('admin');
  const supervisor = admin || eventRoles.includes('supervisor');
  const scanner = supervisor || eventRoles.includes('scanner');
  const finances = organizationRoles.includes('owner') || eventRoles.includes('supervisor');
  const sections: EventSection[] = ['overview'];
  if (scanner) sections.push('entry');
  if (admin) sections.push('door');
  if (supervisor) sections.push('tickets');
  if (finances) sections.push('finances');
  if (organizationAdmin) sections.push('team');
  return { admin, supervisor, scanner, finances, owner: organizationRoles.includes('owner'), organizationAdmin, sections,
    defaultSection: (scanner && !supervisor ? 'entry' : 'overview') as EventSection,
    label: organizationRoles.includes('owner') ? 'Propietario' : admin ? 'Administrador' : supervisor ? 'Supervisor' : scanner ? 'Personal de puerta' : 'Miembro',
  };
}
