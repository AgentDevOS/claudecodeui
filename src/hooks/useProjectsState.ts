import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
  SessionProvider,
} from '../types/app';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

type LocatedSessionResult = {
  project: Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;
  session: ProjectSession;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.geminiSessions) !== serialize(prevProject.geminiSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

const getProviderSessionKey = (provider: SessionProvider): 'sessions' | 'cursorSessions' | 'codexSessions' | 'geminiSessions' => {
  switch (provider) {
    case 'claude':
      return 'sessions';
    case 'cursor':
      return 'cursorSessions';
    case 'codex':
      return 'codexSessions';
    case 'gemini':
      return 'geminiSessions';
  }
};

const normalizeLocatedSession = (projectName: string, session: ProjectSession): ProjectSession => ({
  ...session,
  __provider: (session.__provider || 'claude') as SessionProvider,
  __projectName: session.__projectName || projectName,
});

const mergeLocatedSessionIntoProject = (project: Project, session: ProjectSession): Project => {
  const provider = (session.__provider || 'claude') as SessionProvider;
  const key = getProviderSessionKey(provider);
  const currentSessions = Array.isArray(project[key]) ? project[key] : [];
  const nextSessions = currentSessions.some((item) => item.id === session.id)
    ? currentSessions.map((item) => (item.id === session.id ? { ...item, ...session } : item))
    : [session, ...currentSessions];

  return {
    ...project,
    [key]: nextSessions,
  };
};

const findSessionAcrossProjects = (projects: Project[], sessionId: string) => {
  for (const project of projects) {
    const session = getProjectSessions(project).find((item) => item.id === sessionId);
    if (session) {
      return {
        project,
        session,
      };
    }
  }

  return null;
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = new Set(['chat', 'delivery', 'files', 'shell', 'git', 'tasks', 'preview']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locatingSessionIdRef = useRef<string | null>(null);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      if (showLoadingState) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    await fetchProjects({ showLoadingState: false });
  }, [fetchProjects]);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    const projectsMessage = latestMessage as ProjectsUpdatedMessage;

    if (projectsMessage.changedFile && selectedSession && selectedProject) {
      const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');

        if (changedSessionId === selectedSession.id) {
          const isSessionActive = activeSessions.has(selectedSession.id);

          if (!isSessionActive) {
            setExternalMessageUpdate((prev) => prev + 1);
          }
        }
      }
    }

    const hasActiveSession =
      (selectedSession && activeSessions.has(selectedSession.id)) ||
      (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

    const updatedProjects = projectsMessage.projects;

    if (
      hasActiveSession &&
      !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
    ) {
      return;
    }

    setProjects(updatedProjects);

    if (!selectedProject) {
      return;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === selectedProject.name,
    );

    if (!updatedSelectedProject) {
      return;
    }

    if (!selectedSession) {
      if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
        setSelectedProject(updatedSelectedProject);
      }
      return;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === selectedSession.id,
    );

    if (!updatedSelectedSession) {
      if (sessionId === selectedSession.id) {
        setSelectedProject(mergeLocatedSessionIntoProject(
          updatedSelectedProject,
          normalizeLocatedSession(updatedSelectedProject.name, selectedSession),
        ));
        return;
      }
      setSelectedSession(null);
      return;
    }

    if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
      setSelectedProject(updatedSelectedProject);
    }
  }, [latestMessage, selectedProject, selectedSession, activeSessions, projects, sessionId]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    const match = findSessionAcrossProjects(projects, sessionId);
    if (!match) {
      return;
    }

    const normalizedSession = normalizeLocatedSession(match.project.name, match.session);
    const shouldUpdateProject = selectedProject?.name !== match.project.name;
    const shouldUpdateSession =
      selectedSession?.id !== sessionId || selectedSession.__provider !== normalizedSession.__provider;

    if (shouldUpdateProject) {
      setSelectedProject(match.project);
    }
    if (shouldUpdateSession) {
      setSelectedSession(normalizedSession);
    }
  }, [sessionId, projects, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      locatingSessionIdRef.current = null;
      return;
    }

    if (findSessionAcrossProjects(projects, sessionId)) {
      locatingSessionIdRef.current = null;
      return;
    }

    if (locatingSessionIdRef.current === sessionId) {
      return;
    }
    locatingSessionIdRef.current = sessionId;

    let cancelled = false;

    const restoreSession = async () => {
      try {
        const response = await api.locateSession(sessionId);
        if (!response.ok) {
          return;
        }

        const located = (await response.json()) as LocatedSessionResult;
        if (cancelled) {
          return;
        }

        const normalizedSession = normalizeLocatedSession(located.project.name, located.session);
        const hydratedProjectBase = projects.find((project) => project.name === located.project.name) ?? {
          ...located.project,
          sessions: [],
          cursorSessions: [],
          codexSessions: [],
          geminiSessions: [],
        };
        const hydratedProject = mergeLocatedSessionIntoProject(hydratedProjectBase, normalizedSession);

        setProjects((prevProjects) => {
          const existingProject = prevProjects.find((project) => project.name === located.project.name);
          if (!existingProject) {
            return prevProjects;
          }

          return prevProjects.map((project) => (
            project.name === located.project.name
              ? mergeLocatedSessionIntoProject(project, normalizedSession)
              : project
          ));
        });

        setSelectedProject(hydratedProject);
        setSelectedSession(normalizedSession);
      } catch (error) {
        console.error('Error locating session by id:', error);
      } finally {
        if (!cancelled && locatingSessionIdRef.current === sessionId) {
          locatingSessionIdRef.current = null;
        }
      }
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [projects, sessionId]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      const sessionProjectName = typeof session.__projectName === 'string' ? session.__projectName : null;
      if (sessionProjectName) {
        const matchedProject = projects.find((project) => project.name === sessionProjectName);
        if (matchedProject && matchedProject.name !== selectedProject?.name) {
          setSelectedProject(matchedProject);
        }
      }

      setSelectedSession(session);

      if (activeTab === 'tasks' || activeTab === 'preview') {
        setActiveTab('chat');
      }

      const provider = localStorage.getItem('selected-provider') || 'codex';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, projects, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
