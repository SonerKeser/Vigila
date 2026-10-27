namespace Vigila.Core;

/// <summary>Analizlerde kullanılan dağılım işlevleri ve testler. Dış kütüphane gerektirmez.</summary>
public static class Distributions
{
    /// <summary>
    /// Standart normal dağılımın ters birikimli işlevi (Acklam yöntemi, bağıl hata &lt; 1.15e-9).
    /// </summary>
    public static double InverseNormal(double p)
    {
        if (p <= 0) return double.NegativeInfinity;
        if (p >= 1) return double.PositiveInfinity;

        double[] a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
        double[] b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
        double[] c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
        double[] d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
        const double low = 0.02425, high = 1 - low;

        if (p < low)
        {
            double q = Math.Sqrt(-2 * Math.Log(p));
            return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        }
        if (p > high)
        {
            double q = Math.Sqrt(-2 * Math.Log(1 - p));
            return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        }
        double r = p - 0.5, s = r * r;
        return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
    }

    /// <summary>Student t dağılımında iki yönlü p değeri.</summary>
    public static double TwoTailedP(double t, int df)
    {
        if (df <= 0 || double.IsNaN(t)) return double.NaN;
        double x = df / (df + t * t);
        return Math.Clamp(RegularizedBeta(x, df / 2.0, 0.5), 0, 1);
    }

    /// <summary>Düzenlenmiş eksik beta işlevi I_x(a, b) (Numerical Recipes, sürekli kesir).</summary>
    public static double RegularizedBeta(double x, double a, double b)
    {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        double front = Math.Exp(LogGamma(a + b) - LogGamma(a) - LogGamma(b) + a * Math.Log(x) + b * Math.Log(1 - x));
        return x < (a + 1) / (a + b + 2)
            ? front * BetaContinuedFraction(x, a, b) / a
            : 1 - front * BetaContinuedFraction(1 - x, b, a) / b;
    }

    private static double BetaContinuedFraction(double x, double a, double b)
    {
        const int maxIterations = 300;
        const double eps = 3e-14, tiny = 1e-300;
        double qab = a + b, qap = a + 1, qam = a - 1;
        double c = 1, d = 1 - qab * x / qap;
        if (Math.Abs(d) < tiny) d = tiny;
        d = 1 / d;
        double h = d;
        for (int m = 1; m <= maxIterations; m++)
        {
            int m2 = 2 * m;
            double aa = m * (b - m) * x / ((qam + m2) * (a + m2));
            d = 1 + aa * d; if (Math.Abs(d) < tiny) d = tiny;
            c = 1 + aa / c; if (Math.Abs(c) < tiny) c = tiny;
            d = 1 / d;
            h *= d * c;
            aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
            d = 1 + aa * d; if (Math.Abs(d) < tiny) d = tiny;
            c = 1 + aa / c; if (Math.Abs(c) < tiny) c = tiny;
            d = 1 / d;
            double delta = d * c;
            h *= delta;
            if (Math.Abs(delta - 1) < eps) break;
        }
        return h;
    }

    /// <summary>Lanczos yaklaşımıyla log Γ(x).</summary>
    public static double LogGamma(double x)
    {
        double[] g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
        if (x < 0.5) return Math.Log(Math.PI / Math.Abs(Math.Sin(Math.PI * x))) - LogGamma(1 - x);
        x -= 1;
        double sum = 0.99999999999980993;
        for (int i = 0; i < g.Length; i++) sum += g[i] / (x + i + 1);
        double t = x + g.Length - 0.5;
        return 0.5 * Math.Log(2 * Math.PI) + (x + 0.5) * Math.Log(t) - t + Math.Log(sum);
    }
}

/// <summary>Eşleştirilmiş t-testi sonucu: A − B farkı, t, serbestlik derecesi, iki yönlü p ve Cohen dz.</summary>
public sealed record PairedTest(int N, double MeanDiff, double SdDiff, double T, int Df, double P, double Dz);

public static class HypothesisTests
{
    public static PairedTest? Paired(IReadOnlyList<(double A, double B)> pairs)
    {
        int n = pairs.Count;
        if (n < 2) return null;
        var diffs = pairs.Select(p => p.A - p.B).ToArray();
        double mean = diffs.Average();
        double sd = Math.Sqrt(diffs.Sum(d => (d - mean) * (d - mean)) / (n - 1));
        if (sd == 0) return new PairedTest(n, Math.Round(mean, 2), 0, double.NaN, n - 1, double.NaN, double.NaN);
        double t = mean / (sd / Math.Sqrt(n));
        return new PairedTest(n, Math.Round(mean, 2), Math.Round(sd, 2), Math.Round(t, 3), n - 1, Math.Round(Distributions.TwoTailedP(t, n - 1), 5), Math.Round(mean / sd, 3));
    }
}

/// <summary>
/// Sinyal algılama kuramı ölçütleri. Uç oranlar (0 ya da 1) için log-doğrusal düzeltme kullanılır (Hautus, 1995):
/// H = (isabet + 0,5) / (uyaran + 1), F = (yanlış alarm + 0,5) / (fırsat + 1).
/// </summary>
public static class SignalDetection
{
    public static (double DPrime, double Criterion)? Compute(int hits, int signals, int falseAlarms, int opportunities)
    {
        if (signals <= 0 || opportunities <= 0) return null;
        double h = (hits + 0.5) / (signals + 1.0);
        double f = (Math.Min(falseAlarms, opportunities) + 0.5) / (opportunities + 1.0);
        double zh = Distributions.InverseNormal(h), zf = Distributions.InverseNormal(f);
        return (Math.Round(zh - zf, 3), Math.Round(-(zh + zf) / 2, 3));
    }
}
