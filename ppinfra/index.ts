import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as synced_folder from "@pulumi/synced-folder";

// Create an AWS provider with the region specified in deploy.yml
const provider = new aws.Provider("escProvider", {
    region: "us-east-1", // Match the region in deploy.yml
});

// Import the program's configuration settings
const config = new pulumi.Config();
const path = config.get("path") || "./www"; // Local folder containing website files
const indexDocument = config.get("indexDocument") || "index.html";
const errorDocument = config.get("errorDocument") || "error.html";

// Create an S3 bucket and configure it as a website
const bucket = new aws.s3.Bucket("my-bucket", {
    website: {
        indexDocument: indexDocument,
        errorDocument: errorDocument,
    },
}, { provider });

// Configure website hosting for the S3 bucket
const bucketWebsite = new aws.s3.BucketWebsiteConfigurationV2("bucketWebsite", {
    bucket: bucket.bucket,
    indexDocument: { suffix: indexDocument },
    errorDocument: { key: errorDocument },
}, { provider });

// Configure ownership controls for the S3 bucket
const ownershipControls = new aws.s3.BucketOwnershipControls("ownership-controls", {
    bucket: bucket.bucket,
    rule: {
        objectOwnership: "ObjectWriter",
    },
}, { provider });

// Configure public access block to allow public access
const publicAccessBlock = new aws.s3.BucketPublicAccessBlock("public-access-block", {
    bucket: bucket.bucket,
    blockPublicAcls: false,
}, { provider });

// Use a synced folder to manage the files of the website
const bucketFolder = new synced_folder.S3BucketFolder("bucket-folder", {
    path: path,
    bucketName: bucket.bucket,
    acl: "public-read",
}, { dependsOn: [ownershipControls, publicAccessBlock], provider });

// Create a CloudFront CDN to distribute and cache the website
const cdn = new aws.cloudfront.Distribution("cdn", {
    enabled: true,
    origins: [{
        originId: bucket.arn,
        domainName: bucket.bucketRegionalDomainName, // Use the S3 bucket's regional domain name
        s3OriginConfig: {
            originAccessIdentity: "", // Empty string since we're using public-read ACL
        },
    }],
    defaultRootObject: indexDocument,
    defaultCacheBehavior: {
        targetOriginId: bucket.arn,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        forwardedValues: {
            queryString: false, // Don’t forward query strings for better caching
            cookies: { forward: "none" }, // Don’t forward cookies for better caching
        },
        minTtl: 0,
        defaultTtl: 86400, // 1 day
        maxTtl: 31536000, // 1 year
    },
    priceClass: "PriceClass_100",
    customErrorResponses: [{
        errorCode: 404,
        responseCode: 404,
        responsePagePath: `/${errorDocument}`,
    }],
    restrictions: {
        geoRestriction: {
            restrictionType: "none",
        },
    },
    viewerCertificate: {
        cloudfrontDefaultCertificate: true,
    },
}, { provider });

// Export the URLs and hostnames of the bucket and distribution
export const originURL = pulumi.interpolate`http://${bucketWebsite.websiteEndpoint}`;
export const originHostname = bucketWebsite.websiteEndpoint;
export const cdnURL = pulumi.interpolate`https://${cdn.domainName}`;
export const cdnHostname = cdn.domainName;
