import type { Project, ProjectMeta } from './types';
import { getProject, listProjects } from './store';

/** Project publik yang sudah dipublish. */
export async function publicProjects(): Promise<{ projects: ProjectMeta[]; error?: string }> {
  try {
    const all = await listProjects();
    const projects = all.filter((p) => p.published);
    return { projects };
  } catch (e: any) {
    return { projects: [], error: e.message };
  }
}

export async function loadProject(slug: string, admin = false): Promise<Project | null> {
  try {
    const p = await getProject(slug);
    if (!p) return null;
    return p.published || admin ? p : null;
  } catch {
    return null;
  }
}
