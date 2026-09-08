using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("WITHBID-PPBM Online Setup")]
[assembly: AssemblyDescription("WITHBID-PPBM 온라인 설치 프로그램")]
[assembly: AssemblyProduct("WITHBID-PPBM")]
[assembly: AssemblyCompany("WITHUS")]
[assembly: AssemblyVersion("__ASSEMBLY_VERSION__")]
[assembly: AssemblyFileVersion("__ASSEMBLY_VERSION__")]

namespace WithbidPpbm.OnlineSetup
{
    internal sealed class InstallerForm : Form
    {
        private const string AppVersion = "__APP_VERSION__";
        private const string AppZipSha256 = "__APP_ZIP_SHA256__";
        private const string InstallerSha256 = "__INSTALLER_SHA256__";
        private static readonly string ReleaseBaseUrl =
            "https://github.com/Choongsik-Yoo/WITHBID-PPBM/releases/download/v" + AppVersion;

        private readonly Label statusLabel;
        private readonly ProgressBar progressBar;
        private readonly Label percentLabel;
        private bool started;

        internal InstallerForm()
        {
            Text = "WITHBID-PPBM v" + AppVersion + " 온라인 설치";
            Width = 540;
            Height = 220;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;
            BackColor = Color.FromArgb(247, 248, 245);
            Font = new Font("Malgun Gothic", 10F, FontStyle.Regular, GraphicsUnit.Point);

            var titleLabel = new Label
            {
                Text = "WITHBID-PPBM 온라인 설치",
                Font = new Font("Malgun Gothic", 16F, FontStyle.Bold, GraphicsUnit.Point),
                ForeColor = Color.FromArgb(18, 76, 58),
                Left = 28,
                Top = 22,
                Width = 470,
                Height = 38
            };

            statusLabel = new Label
            {
                Text = "설치를 준비하고 있습니다.",
                Left = 30,
                Top = 72,
                Width = 420,
                Height = 28
            };

            percentLabel = new Label
            {
                Text = "0%",
                Left = 452,
                Top = 72,
                Width = 52,
                Height = 28,
                TextAlign = ContentAlignment.TopRight
            };

            progressBar = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Left = 30,
                Top = 110,
                Width = 474,
                Height = 25,
                Style = ProgressBarStyle.Continuous
            };

            var noteLabel = new Label
            {
                Text = "인터넷 연결을 유지해 주세요. 설치가 끝나면 바탕화면 아이콘이 생성됩니다.",
                ForeColor = Color.DimGray,
                Left = 30,
                Top = 145,
                Width = 474,
                Height = 26
            };

            Controls.Add(titleLabel);
            Controls.Add(statusLabel);
            Controls.Add(percentLabel);
            Controls.Add(progressBar);
            Controls.Add(noteLabel);
            Shown += async delegate { await BeginInstallationAsync(); };
        }

        private void SetProgress(int percent, string message)
        {
            var safePercent = Math.Max(0, Math.Min(100, percent));
            progressBar.Value = safePercent;
            percentLabel.Text = safePercent + "%";
            statusLabel.Text = message;
            Application.DoEvents();
        }

        private async Task DownloadAsync(string url, string destination, int startPercent, int span, string message)
        {
            using (var client = new WebClient())
            {
                client.Headers.Add(HttpRequestHeader.UserAgent, "WITHBID-PPBM-Online-Setup/" + AppVersion);
                client.DownloadProgressChanged += delegate(object sender, DownloadProgressChangedEventArgs args)
                {
                    BeginInvoke((Action)delegate
                    {
                        SetProgress(startPercent + (args.ProgressPercentage * span / 100), message);
                    });
                };
                await client.DownloadFileTaskAsync(new Uri(url), destination);
            }
        }

        private static void VerifySha256(string filePath, string expectedHash)
        {
            string actualHash;
            using (var stream = File.OpenRead(filePath))
            using (var sha = SHA256.Create())
            {
                actualHash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", string.Empty);
            }

            if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("다운로드 파일 검증에 실패했습니다. 다시 실행해 주세요.");
            }
        }

        private async Task BeginInstallationAsync()
        {
            if (started) return;
            started = true;
            var stagingRoot = Path.Combine(Path.GetTempPath(), "withbid-online-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stagingRoot);
            var appZip = Path.Combine(stagingRoot, "WITHBID-PPBM-app.zip");
            var installerScript = Path.Combine(stagingRoot, "Install-WITHBID-PPBM.ps1");

            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                SetProgress(2, "앱 파일을 다운로드하고 있습니다.");
                await DownloadAsync(ReleaseBaseUrl + "/WITHBID-PPBM-app.zip", appZip, 2, 78,
                    "앱 파일을 다운로드하고 있습니다.");
                SetProgress(82, "설치 프로그램을 다운로드하고 있습니다.");
                await DownloadAsync(ReleaseBaseUrl + "/Install-WITHBID-PPBM.ps1", installerScript, 82, 8,
                    "설치 프로그램을 다운로드하고 있습니다.");

                SetProgress(91, "다운로드 파일을 검증하고 있습니다.");
                VerifySha256(appZip, AppZipSha256);
                VerifySha256(installerScript, InstallerSha256);

                SetProgress(95, "WITHBID-PPBM을 설치하고 있습니다.");
                var processInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + installerScript + "\"",
                    WorkingDirectory = stagingRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var process = Process.Start(processInfo))
                {
                    if (process == null) throw new InvalidOperationException("설치 프로그램을 시작하지 못했습니다.");
                    await Task.Run(delegate { process.WaitForExit(); });
                    if (process.ExitCode != 0) throw new InvalidOperationException("설치가 완료되지 않았습니다.");
                }

                SetProgress(100, "설치가 완료되었습니다.");
                MessageBox.Show(this,
                    "WITHBID-PPBM v" + AppVersion + " 설치가 완료되었습니다.\n\n바탕화면의 WITHBID-PPBM 아이콘으로 실행하세요.",
                    "WITHBID-PPBM 설치 완료", MessageBoxButtons.OK, MessageBoxIcon.Information);
                Close();
            }
            catch (Exception error)
            {
                MessageBox.Show(this,
                    error.Message + "\n\n인터넷 연결과 GitHub 접속 여부를 확인한 뒤 다시 실행해 주세요.",
                    "WITHBID-PPBM 설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
            finally
            {
                try { Directory.Delete(stagingRoot, true); } catch { }
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
