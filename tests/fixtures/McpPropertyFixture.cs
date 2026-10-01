using System;
using UnityEngine;

public sealed class McpPropertyFixture : MonoBehaviour
{
    public enum SparseMode { First = 0, Second = 4, Third = 9 }
    [Flags] public enum Mask { A = 1, B = 2, C = 4 }

    public SparseMode mode;
    public Mask mask = Mask.A | Mask.B;
    public Light lightReference;
}
