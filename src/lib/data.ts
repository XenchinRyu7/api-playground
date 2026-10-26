import type { Project, ProjectMeta } from './types';
import { getProject, listProjects, toMeta } from './store';
import { demoProjects } from './project';

/** Project publik. Jika belum ada satupun yang dipublish, tampilkan project demo. */
export async function publicProjects(): Promise<{ projects: ProjectMeta[]; demo: boolean; error?: string }> {
  try {
    const projects = await listProjects();
    if (projects.length) return { projects, demo: false };
  } catch (e: any) {
    return { projects: demoProjects().map(toMeta), demo: true, error: e.message };
  }
  return { projects: demoProjects().map(toMeta), demo: true };
}

export async function loadProject(slug: string, admin = false): Promise<Project | null> {
  let p: Project | null = null;
  try { p = await getProject(slug); } catch { /* storage tidak tersedia → coba demo */ }
  if (p) return p.published || admin ? p : null;
  return demoProjects().find((d) => d.slug === slug) ?? null;
}
