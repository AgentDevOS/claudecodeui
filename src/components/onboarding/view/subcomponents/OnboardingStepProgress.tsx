import { Check, GitBranch, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type OnboardingStepProgressProps = {
  currentStep: number;
};

export default function OnboardingStepProgress({ currentStep }: OnboardingStepProgressProps) {
  const { t } = useTranslation('onboarding');
  const onboardingSteps = [
    { title: t('progress.steps.gitConfiguration'), icon: GitBranch, required: true },
    { title: t('progress.steps.connectAgents'), icon: LogIn, required: false },
  ];

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {onboardingSteps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const Icon = step.icon;

          return (
            <div key={step.title} className="contents">
              <div className="flex flex-1 flex-col items-center">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition-colors duration-200 ${
                    isCompleted
                      ? 'border-green-500 bg-green-500 text-white'
                      : isActive
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
                </div>

                <div className="mt-2 text-center">
                  <p className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {step.title}
                  </p>
                  {step.required && <span className="text-xs text-red-500">{t('progress.required')}</span>}
                </div>
              </div>

              {index < onboardingSteps.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 transition-colors duration-200 ${isCompleted ? 'bg-green-500' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
