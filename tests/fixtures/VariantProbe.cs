namespace UnityMcpValidationFixtures
{
    public static class VariantProbe
    {
#if UNITY_ENABLE_CHECKS
        public const bool Checks = true;
#else
        public const bool Checks = false;
#endif
#if UNITY_INCLUDE_INSTRUMENTATION
        public const bool Instrumentation = true;
#else
        public const bool Instrumentation = false;
#endif
#if DEBUG
        public const bool DebugSymbols = true;
#else
        public const bool DebugSymbols = false;
#endif
    }
}
