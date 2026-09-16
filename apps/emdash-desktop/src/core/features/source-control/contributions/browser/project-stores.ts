import {
  projectSettingsStoreToken,
  type ProjectScopedStoreContext,
} from '@core/features/projects/contributions/project-stores';
import { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { developerSurfacesSnapshot } from '@core/features/workbench/api/browser/mode-developer-surfaces';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { TaskPrSyncCoordinator } from '../../browser/stores/task-pr-sync-coordinator';

export const gitRepositoryStoreToken = scopedStoreToken<GitRepositoryStore>(
  'source-control.repository'
);
/**
 * Null while non-developer mode is on: the coordinator watches PR sync and
 * reacts to every task's git head, and this app's users have no pull requests.
 * Nothing reads this token, so null costs nothing.
 */
export const taskPrSyncCoordinatorToken = scopedStoreToken<TaskPrSyncCoordinator | null>(
  'source-control.task-pr-sync'
);

export const sourceControlProjectStoreContributions: readonly ScopedStoreContribution<ProjectScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: gitRepositoryStoreToken,
      create: ({ project, host }, stores) =>
        new GitRepositoryStore(project.id, stores.get(projectSettingsStoreToken), host),
      // The store is always created — selectors across the app call
      // `stores.get(gitRepositoryStoreToken)`, which throws when a token is not
      // registered — but it only starts polling git when the developer surfaces
      // that read it are visible. An Odoo project folder with no git repository
      // simply never starts.
      activate: (store) => {
        if (developerSurfacesSnapshot().showSourceControl) store.start();
      },
      dispose: (store) => store.dispose(),
    }),
  ];

export const sourceControlTaskProjectStoreContributions: readonly ScopedStoreContribution<ProjectScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: taskPrSyncCoordinatorToken,
      create: (_context, stores) =>
        developerSurfacesSnapshot().showPullRequests
          ? new TaskPrSyncCoordinator(
              stores.get(taskManagerStoreToken),
              stores.get(gitRepositoryStoreToken)
            )
          : null,
      dispose: (coordinator) => coordinator?.dispose(),
    }),
  ];
