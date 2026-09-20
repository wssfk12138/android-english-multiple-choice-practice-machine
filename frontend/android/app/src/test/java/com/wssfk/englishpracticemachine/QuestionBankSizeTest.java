package com.wssfk.englishpracticemachine;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import static org.junit.Assert.*;

public class QuestionBankSizeTest {
    @Test public void acceptsActualCatalogJsonSizesIgnoredByCapacitorGetLong() throws Exception {
        for (long size : new long[]{294673, 338288, 429043776, 844861464}) {
            JSObject data = new JSObject("{\"expectedSize\":" + size + "}");
            PluginCall call = new PluginCall(null, "AppUpdater", "qa", "downloadQuestionBank", data);
            assertTrue(data.opt("expectedSize") instanceof Integer);
            assertNull(call.getLong("expectedSize"));
            assertEquals(Long.valueOf(size), AppUpdaterPlugin.readQuestionBankSize(data.opt("expectedSize")));
        }
    }

    @Test public void acceptsWholeNumbersThroughTwoGiB() {
        assertEquals(Long.valueOf(1), AppUpdaterPlugin.readQuestionBankSize(1));
        assertEquals(Long.valueOf(294673), AppUpdaterPlugin.readQuestionBankSize(294673.0));
        assertEquals(Long.valueOf(2147483648L), AppUpdaterPlugin.readQuestionBankSize(2147483648L));
    }

    @Test public void rejectsInvalidSizesWithoutCoercion() {
        for (Object value : new Object[]{null, "294673", true, 0, -1, 1.5,
                Double.NaN, Double.POSITIVE_INFINITY, 2147483649L, Long.MAX_VALUE}) {
            assertNull(String.valueOf(value), AppUpdaterPlugin.readQuestionBankSize(value));
        }
    }
}
