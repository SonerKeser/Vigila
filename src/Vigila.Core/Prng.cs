namespace Vigila.Core;

/// <summary>
/// Tohumlanabilir, platformdan bağımsız rastgele sayı üreteci (xoshiro128**).
/// Aynı tohum her makinede aynı diziyi verir; böylece bir oturumun uyaran planı yeniden üretilebilir.
/// </summary>
public sealed class Prng
{
    private uint _s0, _s1, _s2, _s3;

    public Prng(uint seed)
    {
        // splitmix32 ile 128 bitlik durumu doldur.
        uint x = seed;
        _s0 = SplitMix(ref x);
        _s1 = SplitMix(ref x);
        _s2 = SplitMix(ref x);
        _s3 = SplitMix(ref x);
        if ((_s0 | _s1 | _s2 | _s3) == 0) _s0 = 0x9E3779B9;
    }

    private static uint SplitMix(ref uint x)
    {
        unchecked
        {
            x += 0x9E3779B9;
            uint z = x;
            z = (z ^ (z >> 16)) * 0x85EBCA6B;
            z = (z ^ (z >> 13)) * 0xC2B2AE35;
            return z ^ (z >> 16);
        }
    }

    private static uint Rotl(uint v, int k) => (v << k) | (v >> (32 - k));

    public uint NextUInt()
    {
        unchecked
        {
            uint result = Rotl(_s1 * 5, 7) * 9;
            uint t = _s1 << 9;
            _s2 ^= _s0;
            _s3 ^= _s1;
            _s1 ^= _s2;
            _s0 ^= _s3;
            _s2 ^= t;
            _s3 = Rotl(_s3, 11);
            return result;
        }
    }

    /// <summary>[0, 1) aralığında sayı.</summary>
    public double NextDouble() => NextUInt() / 4294967296.0;

    /// <summary>[min, maxExclusive) aralığında tamsayı.</summary>
    public int NextInt(int min, int maxExclusive)
    {
        if (maxExclusive <= min) return min;
        return min + (int)(NextDouble() * (maxExclusive - min));
    }

    public void Shuffle<T>(IList<T> list)
    {
        for (int i = list.Count - 1; i > 0; i--)
        {
            int j = NextInt(0, i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }
}
