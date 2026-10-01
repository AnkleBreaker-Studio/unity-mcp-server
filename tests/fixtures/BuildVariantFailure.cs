using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

namespace UnityMcpValidationFixtures
{
    public sealed class BuildVariantFailure : IPreprocessBuildWithReport
    {
        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
#if UNITY_6000_6_OR_NEWER
            if (!SessionState.GetBool("UnityMcpValidation.FailBuild", false)) return;
            SessionState.SetString("UnityMcpValidation.FailedBuildVariant",
                PlayerSettings.GetManagedCodeVariant(NamedBuildTarget.Standalone).ToString());
            throw new BuildFailedException("Intentional MCP validation build failure");
#endif
        }
    }
}
