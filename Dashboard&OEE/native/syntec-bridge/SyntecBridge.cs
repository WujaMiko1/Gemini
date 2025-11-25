using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Syntec.Remote;

public class SyntecBridge
{
    private static Dictionary<string, SyntecRemoteCNC> cncInstances = new Dictionary<string, SyntecRemoteCNC>();

    private SyntecRemoteCNC GetCnc(string ip)
    {
        if (!cncInstances.ContainsKey(ip))
        {
            cncInstances[ip] = new SyntecRemoteCNC(ip);
        }
        return cncInstances[ip];
    }

    public async Task<object> Invoke(dynamic options)
    {
        string ip = (string)options.ip;
        string command = (string)options.command;

        if (string.IsNullOrEmpty(ip) || string.IsNullOrEmpty(command))
        {
            return new { error = "IP and command must be provided." };
        }

        var cnc = GetCnc(ip);

        switch (command.ToLower())
        {
            case "getdata":
                return await Task.Run(() => GetData(cnc));
            case "getgcode":
                return await Task.Run(() => GetGCode(cnc));
            default:
                return new { error = "Unknown command." };
        }
    }

    private object GetData(SyntecRemoteCNC cnc)
    {
        // READ_status
        int nCurSeq = 0;
        string szMainProg = "", szCurProg = "", szMode = "", szStatus = "", szAlarm = "", szEMG = "";
        cnc.READ_status(out szMainProg, out szCurProg, out nCurSeq, out szMode, out szStatus, out szAlarm, out szEMG);

        // READ_position
        short nDecPoint = 0;
        string[] szAxesName = null, szUnits = null;
        float[] Mach = null, Abs = null, Rel = null, Dist = null;
        cnc.READ_position(out szAxesName, out nDecPoint, out szUnits, out Mach, out Abs, out Rel, out Dist);

        // READ_spindle
        float OvFeed = 0.0F, OvSpindle = 0.0F, ActFeed = 0.0F;
        int nActSpindle = 0;
        cnc.READ_spindle(out OvFeed, out OvSpindle, out ActFeed, out nActSpindle);

        // READ_alm_current
        bool isAlarm = false;
        string[] szMsg = null;
        DateTime[] time = null;
        cnc.READ_alm_current(out isAlarm, out szMsg, out time);

        // READ_nc_pointer
        int nLineNo = 0;
        cnc.READ_nc_pointer(out nLineNo);

        var snapshot = new Dictionary<string, object>
        {
            { "ts", DateTimeOffset.Now.ToUnixTimeMilliseconds() },
            { "currentProgram", szCurProg.Trim() },
            { "status", szStatus.Trim() },
            { "mode", szMode.Trim() },
            { "feedrateOverride", OvFeed },
            { "actualFeedrate", ActFeed },
            { "currentAlarmMessages", szMsg != null ? string.Join("\n", szMsg) : (szAlarm ?? "") },
            { "isAlarm", isAlarm },
            { "isEmergency", szEMG == "1" || szEMG.ToLower() == "true" },
            { "pointer", nLineNo }
        };

        var pos = new Dictionary<string, object>();
        if (Mach != null && szAxesName != null)
        {
            for (int i = 0; i < Math.Min(Mach.Length, szAxesName.Length); i++)
            {
                pos[szAxesName[i].ToLower()] = Mach[i];
            }
        }
        snapshot["pos"] = pos;

        return snapshot;
    }

    private object GetGCode(SyntecRemoteCNC cnc)
    {
        string[] szGCodeList = null;
        short result = cnc.READ_gcode(out szGCodeList);

        if (result == (short)SyntecRemoteCNC.ErrorCode.NormalTermination && szGCodeList != null)
        {
            return string.Join("\n", szGCodeList);
        }
        return "";
    }
}
