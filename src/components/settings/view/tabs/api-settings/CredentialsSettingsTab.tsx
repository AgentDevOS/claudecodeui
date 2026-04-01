import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../../auth/context/AuthContext';
import { useVersionCheck } from '../../../../../hooks/useVersionCheck';
import { useCredentialsSettings } from '../../../hooks/useCredentialsSettings';
import ApiKeysSection from './sections/ApiKeysSection';
import GithubCredentialsSection from './sections/GithubCredentialsSection';
import NewApiKeyAlert from './sections/NewApiKeyAlert';
import VersionInfoSection from './sections/VersionInfoSection';

export default function CredentialsSettingsTab() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const { updateAvailable, latestVersion, currentVersion, releaseInfo } = useVersionCheck('aisoft', 'aisoft');
  const {
    apiKeys,
    githubCredentials,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    showNewGithubForm,
    setShowNewGithubForm,
    newGithubName,
    setNewGithubName,
    newGithubToken,
    setNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showToken,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    createGithubCredential,
    deleteGithubCredential,
    toggleGithubCredential,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
    cancelNewGithubForm,
    toggleNewGithubTokenVisibility,
  } = useCredentialsSettings({
    confirmDeleteApiKeyText: t('apiKeys.confirmDelete'),
    confirmDeleteGithubCredentialText: t('apiKeys.github.confirmDelete'),
  });

  if (loading) {
    return <div className="text-muted-foreground">{t('apiKeys.loading')}</div>;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 text-lg font-semibold">{t('apiKeys.identity.title')}</div>
        <p className="mb-3 text-sm text-muted-foreground">{t('apiKeys.identity.description')}</p>
        <div className="rounded-md bg-muted px-3 py-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('apiKeys.identity.label')}
          </div>
          <code className="text-sm">{user?.publicId || t('apiKeys.identity.unavailable')}</code>
        </div>
      </section>

      {newlyCreatedKey && (
        <NewApiKeyAlert
          apiKey={newlyCreatedKey}
          copiedKey={copiedKey}
          onCopy={copyToClipboard}
          onDismiss={dismissNewlyCreatedKey}
        />
      )}

      <ApiKeysSection
        apiKeys={apiKeys}
        showNewKeyForm={showNewKeyForm}
        newKeyName={newKeyName}
        onShowNewKeyFormChange={setShowNewKeyForm}
        onNewKeyNameChange={setNewKeyName}
        onCreateApiKey={createApiKey}
        onCancelCreateApiKey={cancelNewApiKeyForm}
        onToggleApiKey={toggleApiKey}
        onDeleteApiKey={deleteApiKey}
      />

      <GithubCredentialsSection
        githubCredentials={githubCredentials}
        showNewGithubForm={showNewGithubForm}
        showNewTokenPlainText={Boolean(showToken.new)}
        newGithubName={newGithubName}
        newGithubToken={newGithubToken}
        newGithubDescription={newGithubDescription}
        onShowNewGithubFormChange={setShowNewGithubForm}
        onNewGithubNameChange={setNewGithubName}
        onNewGithubTokenChange={setNewGithubToken}
        onNewGithubDescriptionChange={setNewGithubDescription}
        onToggleNewTokenVisibility={toggleNewGithubTokenVisibility}
        onCreateGithubCredential={createGithubCredential}
        onCancelCreateGithubCredential={cancelNewGithubForm}
        onToggleGithubCredential={toggleGithubCredential}
        onDeleteGithubCredential={deleteGithubCredential}
      />

      <VersionInfoSection
        currentVersion={currentVersion}
        updateAvailable={updateAvailable}
        latestVersion={latestVersion}
        releaseInfo={releaseInfo}
      />
    </div>
  );
}
