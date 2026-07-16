import { nanoid } from "nanoid";
import type {
  NewProduct,
  NewProductSku,
  NewSkuProperty,
  NewProductAttribute,
  ProductImage,
  ProductVideo,
} from "@repo/db";

//aliExpress response types
type AESkuProperty = {
  sku_property_id: number;
  sku_property_name: string;
  property_value_id: number;
  sku_property_value: string;
  property_value_definition_name?: string;
  sku_image?: string;
};

type AESkuInfo = {
  sku_id: string;
  sku_attr: string;
  id: string;
  sku_price: string;
  offer_sale_price: string;
  offer_bulk_sale_price: string;
  sku_available_stock: number;
  currency_code: string;
  price_include_tax: boolean;
  ae_sku_property_dtos: {
    ae_sku_property_d_t_o: AESkuProperty[];
  };
};

type AEItemProperty = {
  attr_name_id: number;
  attr_value_id: number;
  attr_name: string;
  attr_value: string;
  attr_value_unit?: string;
};

type AEVideo = {
  media_url?: string;
  poster_url?: string;
  media_type?: string;
};

type AEProductResponse = {
  aliexpress_ds_product_get_response: {
    result: {
      ae_item_sku_info_dtos: {
        ae_item_sku_info_d_t_o: AESkuInfo[];
      };
      ae_multimedia_info_dto: {
        image_urls: string;
        ae_video_dtos?: {
          ae_video_d_t_o?: AEVideo | AEVideo[];
        };
      };
      ae_item_base_info_dto: {
        subject: string;
        detail: string;
        mobile_detail: string;
        product_id: number;
        category_id: number;
        avg_evaluation_rating: string;
        evaluation_count: string;
        sales_count: string;
        product_status_type: string;
        currency_code: string;
      };
      package_info_dto: {
        package_width: number;
        package_height: number;
        package_length: number;
        gross_weight: string;
      };
      logistics_info_dto: {
        delivery_time: number;
      };
      ae_item_properties: {
        ae_item_property: AEItemProperty[];
      };
      has_whole_sale: boolean;
    };
  };
};

//price helpers
function toCents(price: string | number): number {
  return Math.round(parseFloat(String(price)) * 100);
}
function applyMarkup(aePriceCents: number, markupPercent: number): number {
  return Math.round(aePriceCents * (1 + markupPercent / 100));
}

function toSlug(text: string, id: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base}-${id.slice(-6)}`;
}

function toVideoArray(value: unknown): AEVideo[] {
  if (Array.isArray(value)) return value as AEVideo[];
  if (value && typeof value === "object") return [value as AEVideo];
  return [];
}

//main mapper

type MappedProduct = {
  product: NewProduct;
  skus: Array<{
    sku: NewProductSku;
    properties: NewSkuProperty[];
  }>;
  attributes: NewProductAttribute[];
};

export function mapAEProductToSchema(
  response: AEProductResponse,
  options: {
    categoryId?: string;
    markupPercent?: number;
  } = {}
): MappedProduct {
  const { markupPercent = 100 } = options;
  const result = response.aliexpress_ds_product_get_response.result;
  const baseInfo = result.ae_item_base_info_dto;

  const productId = nanoid();
  const aeProductId = String(baseInfo.product_id);

  const imageUrls = (result.ae_multimedia_info_dto.image_urls ?? "")
    .split(";")
    .map((url) => url.trim())
    .filter(Boolean);

  const images: ProductImage[] = imageUrls.map((url, index) => ({
    url,
    alt: baseInfo.subject.slice(0, 120),
    position: index,
  }));

  const rawVideos = toVideoArray(
    result.ae_multimedia_info_dto.ae_video_dtos?.ae_video_d_t_o
  );
  const videos: ProductVideo[] = [];
  for (const v of rawVideos) {
    const url = typeof v.media_url === "string" ? v.media_url.trim() : "";
    if (!url) continue;
    videos.push({
      url,
      poster: typeof v.poster_url === "string" ? v.poster_url : null,
      alt: baseInfo.subject.slice(0, 120),
    });
  }

  const skuInfos = result.ae_item_sku_info_dtos.ae_item_sku_info_d_t_o ?? [];
  const now = new Date();

  const product: NewProduct = {
    id: productId,
    slug: toSlug(baseInfo.subject, aeProductId),
    name: baseInfo.subject,
    description: baseInfo.detail,
    mobileDetail: baseInfo.mobile_detail,

    isAEProduct: true,
    aeProductId,
    aeCategoryId: String(baseInfo.category_id),
    aeRating: parseFloat(baseInfo.avg_evaluation_rating),
    aeReviewCount: parseInt(baseInfo.evaluation_count, 10),
    aeSalesCount: baseInfo.sales_count,
    aeStatus: baseInfo.product_status_type,
    aeLastSynced: now,

    images,
    videos,
    mainVideo: videos[0]?.url ?? null,

    categoryId: options.categoryId ?? null,
    published: false,
    featured: false,
    position: 0,

    metaTitle: baseInfo.subject.slice(0, 70),
    metaDescription: null,
    tags: [],

    createdAt: now,
    updatedAt: now,
  };

  const skus = skuInfos.map((skuInfo) => {
    const skuId = nanoid();
    const aeSalePrice = toCents(skuInfo.offer_sale_price);
    const ourSkuPrice = applyMarkup(aeSalePrice, markupPercent);
    const aeOriginalPrice = toCents(skuInfo.sku_price);

    const properties: NewSkuProperty[] =
      skuInfo.ae_sku_property_dtos?.ae_sku_property_d_t_o?.map((prop) => ({
        id: nanoid(),
        skuId,
        aePropertyId: String(prop.sku_property_id),
        propertyName: prop.sku_property_name,
        aeValueId: String(prop.property_value_id),
        value: prop.sku_property_value,
        valueDefinitionName: prop.property_value_definition_name ?? null,
        image: prop.sku_image ?? null,
      })) ?? [];

    const variantKeys = [
      String(skuInfo.sku_id),
      ...properties
        .map((p) => p.aeValueId)
        .filter((v): v is string => Boolean(v)),
    ];

    const skuImages: ProductImage[] = properties
      .filter((p) => p.image)
      .map((p, index) => ({
        url: p.image as string,
        alt: `${baseInfo.subject} — ${p.propertyName}: ${p.value}`.slice(
          0,
          120
        ),
        variantKeys,
        position: index,
      }));

    const sku: NewProductSku = {
      id: skuId,
      productId,
      aeSkuId: skuInfo.sku_id,
      aeSkuAttr: skuInfo.sku_attr,
      price: ourSkuPrice,
      compareAtPrice: applyMarkup(aeOriginalPrice, markupPercent),
      aePrice: aeOriginalPrice,
      aeSalePrice,
      stock: skuInfo.sku_available_stock,
      sku: null,
      priceIncludesTax: skuInfo.price_include_tax,
      images: skuImages,
      createdAt: now,
    };

    return { sku, properties };
  });

  const attributes: NewProductAttribute[] =
    result.ae_item_properties?.ae_item_property?.map((attr, index) => ({
      id: nanoid(),
      productId,
      aeAttrNameId: String(attr.attr_name_id),
      attrName: attr.attr_name,
      aeAttrValueId: String(attr.attr_value_id),
      attrValue: attr.attr_value,
      attrValueUnit: attr.attr_value_unit ?? null,
      position: index,
    })) ?? [];

  return { product, skus, attributes };
}
