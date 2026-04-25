import { Hono } from "hono";
import type Env from "@/types/env";
import { callAE } from "@/utils/callAE";

import { getAccessToken } from "@/utils/manageAEauthTokens";

const aeProduct = new Hono<{ Bindings: Env }>();


//search products by keyword
aeProduct.get("/product/search", async (c) => {
  const { keyword, local, cc, pagesize, pageindex, currency } = c.req.query();

  if (!keyword) {
    return c.json({ error: "keyword is required" }, 400);
  }

  const pageSizeNum = Number(pagesize) || 20;
  if (pageSizeNum <= 0 || pageSizeNum > 100) {
    return c.json({ error: "pagesize must be between 1 and 100" }, 400);
  }

  const pageIndexNum = Number(pageindex) || 1;
  if (pageIndexNum <= 0) {
    return c.json({ error: "pageindex must be greater than 0" }, 400);
  }

  let session: string;
  try {
    session = await getAccessToken(c.env);
  } catch (error) {
    return c.json({ error: "AliExpress not connected. Please complete OAuth flow." }, 401);
  }

  try {
    const data = await callAE(
      c.env,
      "aliexpress.ds.text.search",
      {
        keyWord: keyword,
        pageSize: pageSizeNum,
        pageIndex: pageIndexNum,
        local: local || "en_US",
        countryCode: cc || "US",
        currency: currency || "USD"
      },
      session
    );
    return c.json(data);
  } catch (error) {
    console.error("Error searching products:", error);
    return c.json({ error: "Failed to search products" }, 500);
  }
});


//get product info by id
aeProduct.get("/product/:id", async (c) => {
  const { id } = c.req.param();
  const { shipToCountry, currency, lang, provinceCode, cityCode, bizModel, removePersonalBenefit } = c.req.query();

  if (!shipToCountry) {
    return c.json({ error: "shipToCountry is required" }, 400);
  }

  let session: string;
  try {
    session = await getAccessToken(c.env);
  } catch (error) {
    return c.json({ error: "AliExpress not connected. Please complete OAuth flow." }, 401);
  }

  try {
    const params: Record<string, any> = {
      product_id: id,
      ship_to_country: shipToCountry,
      target_currency: currency || "USD",
      target_language: lang || "en",
      remove_personal_benefit: removePersonalBenefit === "true" ? "true" : "false",
    };

    if (provinceCode) params.province_code = provinceCode;
    if (cityCode) params.city_code = cityCode;
    if (bizModel) params.biz_model = bizModel;

    const data = await callAE(c.env, "aliexpress.ds.product.get", params, session);
    return c.json(data);
  } catch (error) {
    console.error("Error fetching product info:", error);
    return c.json({ error: "Failed to fetch product info" }, 500);
  }
});

export default aeProduct;